#!/usr/bin/env python3
"""Read-only DolphinScheduler workflow preflight; never fetch version-switch endpoints."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

SAFE_GET = {
    "/v3/api-docs": None,
    "/projects/{projectCode}/process-definition/{code}": "queryProcessDefinitionByCode",
    "/projects/{projectCode}/process-definition/{code}/tasks": "getNodeListByDefinitionCode",
    "/projects/{projectCode}/task-definition/{code}": "queryTaskDefinitionDetail",
    "/projects/{projectCode}/schedules": "queryScheduleListPaging",
}


class ReadOnlyClient:
    def __init__(self, url: str, user: str, password: str) -> None:
        parsed = urllib.parse.urlsplit(url)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("--url 必须是无凭据的 HTTP(S) DS 根地址")
        self.base = url.rstrip("/")
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.spec = self._request("GET", "/v3/api-docs")
        if self.spec.get("info", {}).get("version") != "3.2.0":
            raise ValueError("目标 OpenAPI 不是已核验的 DS 3.2.0，停止检查")
        for path, operation in SAFE_GET.items():
            if operation is None:
                continue
            actual = (
                self.spec.get("paths", {})
                .get(path, {})
                .get("get", {})
                .get("operationId")
            )
            if actual != operation:
                raise ValueError(f"只读接口语义发生变化：{path}")
        login = self.spec.get("paths", {}).get("/login", {}).get("post", {})
        if login.get("operationId") != "login":
            raise ValueError("登录接口语义发生变化")
        response = self._request(
            "POST", "/login", {"userName": user, "userPassword": password}
        )
        self._check(response, "登录")

    def _request(
        self, method: str, path: str, form: dict[str, str] | None = None
    ) -> dict[str, Any]:
        if method == "GET" and path != "/v3/api-docs":
            raise ValueError("只能通过已核验的只读接口调用 GET")
        if method == "POST" and path != "/login":
            raise ValueError("只允许 POST /login")
        if method == "POST" and path == "/login" and form is not None:
            # DS 3.2.0 OpenAPI declares these as required query parameters.
            path = path + "?" + urllib.parse.urlencode(form)
            body = None
        else:
            body = urllib.parse.urlencode(form).encode() if form is not None else None
        request = urllib.request.Request(
            self.base + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
            if body
            else {},
        )
        try:
            with self.opener.open(request, timeout=20) as response:
                result = json.load(response)
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"请求失败：{type(exc).__name__}") from None
        if not isinstance(result, dict):
            raise TypeError("API 未返回 JSON 对象")
        return result

    @staticmethod
    def _check(result: dict[str, Any], action: str) -> Any:
        if result.get("code") != 0:
            raise RuntimeError(f"{action} 失败：DS code={result.get('code')}")
        return result.get("data")

    def get(self, template: str, *, project: int, code: int | None = None) -> Any:
        if template not in SAFE_GET or SAFE_GET[template] is None:
            raise ValueError("接口不在只读白名单")
        path = template.format(projectCode=project, code=code)
        if template.endswith("/schedules"):
            raise ValueError("调度接口必须使用 schedules() 传分页参数")
        result = self._request_allowlisted(path)
        return self._check(result, template)

    def tasks_by_definition(self, project: int, code: int) -> list[dict]:
        template = "/projects/{projectCode}/process-definition/{code}/tasks"
        tasks = self.get(template, project=project, code=code)
        if not isinstance(tasks, list):
            raise RuntimeError("工作流 Task 列表接口未返回列表")
        return tasks

    def schedules(self, project: int, code: int, definition_id: int) -> list[dict]:
        template = "/projects/{projectCode}/schedules"
        query = urllib.parse.urlencode(
            {
                "processDefinitionCode": code,
                "processDefinitionId": definition_id,
                "pageNo": 1,
                "pageSize": 100,
            }
        )
        path = template.format(projectCode=project) + "?" + query
        data = self._check(self._request_allowlisted(path), "查询调度")
        if data.get("total", 0) > 100:
            raise RuntimeError("调度超过一页，停止：需要扩展分页检查")
        schedules = data["totalList"]
        if any(item["processDefinitionCode"] != code for item in schedules):
            raise RuntimeError("调度查询返回了其他工作流的数据")
        return schedules

    def _request_allowlisted(self, path: str) -> dict[str, Any]:
        # Reject arbitrary paths even if a future caller bypasses get(). In
        # particular, GET .../versions/{version} is a state-changing endpoint.
        parsed = urllib.parse.urlsplit(path)
        detail = re.fullmatch(
            r"/projects/\d+/(?:process-definition|task-definition)/\d+", parsed.path
        )
        task_list = re.fullmatch(r"/projects/\d+/process-definition/\d+/tasks", parsed.path)
        schedule = re.fullmatch(r"/projects/\d+/schedules", parsed.path)
        if detail and parsed.query:
            raise ValueError("详情接口不接受额外查询参数")
        if schedule:
            query = urllib.parse.parse_qs(parsed.query)
            expected = {
                "processDefinitionCode",
                "processDefinitionId",
                "pageNo",
                "pageSize",
            }
            if set(query) != expected or any(
                len(value) != 1 or not value[0].isdigit() for value in query.values()
            ):
                raise ValueError("调度查询参数不符合只读白名单")
        if task_list and parsed.query:
            raise ValueError("工作流 Task 列表接口不接受额外查询参数")
        if not detail and not task_list and not schedule:
            raise ValueError("接口不在只读白名单")
        request = urllib.request.Request(self.base + path, method="GET")
        try:
            with self.opener.open(request, timeout=20) as response:
                result = json.load(response)
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"只读请求失败：{type(exc).__name__}") from None
        if not isinstance(result, dict):
            raise TypeError("API 未返回 JSON 对象")
        return result


def validate_definition(data: dict[str, Any]) -> list[str]:
    """Return structural errors without echoing task params or sensitive SQL."""
    problems: list[str] = []
    process = data["processDefinition"]
    tasks = data["taskDefinitionList"]
    relations = data["processTaskRelationList"]
    codes = [task["code"] for task in tasks]
    versions = {task["code"]: task["version"] for task in tasks}
    if not codes or len(codes) != len(versions):
        problems.append("任务列表为空或 Task Code 重复")
    try:
        locations = json.loads(process.get("locations") or "[]")
        if not isinstance(locations, list):
            raise TypeError("locations 不是列表")
        positioned = [item["taskCode"] for item in locations]
        if len(positioned) != len(set(positioned)) or set(positioned) != set(codes):
            problems.append("画布坐标与现存 Task Code 不一一对应")
        for index, left in enumerate(locations):
            for right in locations[index + 1 :]:
                if (
                    abs(left["x"] - right["x"]) < 480
                    and abs(left["y"] - right["y"]) < 160
                ):
                    problems.append("画布节点间距过近，可能在 UI 中重叠")
                    break
    except (ValueError, TypeError, KeyError):
        problems.append("画布坐标不是有效的节点位置列表")
    for relation in relations:
        before, after = relation["preTaskCode"], relation["postTaskCode"]
        if after not in versions or (before != 0 and before not in versions):
            problems.append("依赖边引用了不存在的 Task Code")
            continue
        if relation["postTaskVersion"] != versions[after] or (
            before != 0 and relation["preTaskVersion"] != versions[before]
        ):
            problems.append("依赖边的 Task 版本与当前定义不一致")
    return sorted(set(problems))


def validate_task_list(embedded: list[dict], listed: list[dict]) -> list[str]:
    """Cross-check the workflow's embedded Task definitions against its Task-list API."""
    problems: list[str] = []
    embedded_by_code = {task["code"]: task for task in embedded}
    listed_by_code = {task["code"]: task for task in listed}
    if len(embedded_by_code) != len(embedded) or len(listed_by_code) != len(listed):
        return ["工作流 Task 列表中存在重复 Task Code"]
    if set(embedded_by_code) != set(listed_by_code):
        return ["工作流详情与 Task 列表接口的 Task Code 集合不一致"]
    compared_fields = (
        "name",
        "version",
        "description",
        "taskType",
        "taskParams",
        "flag",
        "taskPriority",
        "workerGroup",
        "environmentCode",
        "resourceIds",
        "taskExecuteType",
        "dependence",
    )
    for code, task in embedded_by_code.items():
        listed_task = listed_by_code[code]
        if any(task.get(key) != listed_task.get(key) for key in compared_fields):
            problems.append(f"Task Code {code} 的工作流详情与 Task 列表定义不一致")
    return problems


def run(client: ReadOnlyClient, project: int, code: int) -> list[str]:
    template = "/projects/{projectCode}/process-definition/{code}"
    data = client.get(template, project=project, code=code)
    process = data["processDefinition"]
    if process["projectCode"] != project or process["code"] != code:
        raise RuntimeError("DS 返回的项目或工作流 Code 不匹配")
    problems = validate_definition(data)
    try:
        listed_tasks = client.tasks_by_definition(project, code)
        if any(task.get("projectCode") != project for task in listed_tasks):
            problems.append("工作流 Task 列表接口返回了其他项目的任务")
        problems.extend(validate_task_list(data["taskDefinitionList"], listed_tasks))
    except RuntimeError as exc:
        problems.append(f"工作流 Task 列表不可读：{exc}")
    for task in data["taskDefinitionList"]:
        if task["taskType"] != "SUB_PROCESS":
            continue
        params = task.get("taskParams") or {}
        child_code = params.get("processDefinitionCode")
        if not isinstance(child_code, int):
            problems.append(f"Task Code {task['code']} 缺少子流程 Code")
            continue
        try:
            child = client.get(template, project=project, code=child_code)[
                "processDefinition"
            ]
        except RuntimeError as exc:
            problems.append(f"子流程 Code {child_code} 不可读：{exc}")
            continue
        if child.get("code") != child_code or child.get("projectCode") != project:
            problems.append(f"子流程 Code {child_code} 详情身份不匹配")
            continue
        pinned = params.get("processDefinitionVersion")
        if pinned and pinned != child["version"]:
            problems.append(
                f"子流程 Code {child_code} 固定 v{pinned}，当前 v{child['version']}；须核实是否有意固定旧版本"
            )
        if process["releaseState"] == "ONLINE" and child["releaseState"] != "ONLINE":
            problems.append(f"子流程 Code {child_code} 非 ONLINE")
    schedules = client.schedules(project, code, process["id"])
    print(
        f"工作流 {process['name']} (Code {code}, v{process['version']}, {process['releaseState']})"
    )
    print(
        "调度："
        + (
            ", ".join(f"{item['id']} {item['releaseState']}" for item in schedules)
            if schedules
            else "无"
        )
    )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="DS 根地址，不含凭据")
    parser.add_argument("--project-code", required=True, type=int)
    parser.add_argument("--workflow-code", required=True, type=int)
    args = parser.parse_args()
    user = os.environ.get("DS_USER")
    password = os.environ.get("DS_PASSWORD")
    if not user or not password:
        parser.error("需通过环境变量 DS_USER 和 DS_PASSWORD 提供凭据")
    try:
        issues = run(
            ReadOnlyClient(args.url, user, password),
            args.project_code,
            args.workflow_code,
        )
    except (RuntimeError, ValueError, KeyError, TypeError) as exc:
        print(f"检查未完成：{exc}", file=sys.stderr)
        return 2
    for item in issues:
        print(f"需人工核对：{item}")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
