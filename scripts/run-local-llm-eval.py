#!/usr/bin/env python3
import json
import os
import re
import time
from pathlib import Path

from llama_cpp import Llama


ROOT = Path.cwd()
DEBUG_DIR = ROOT / "manuals" / "generated-debug" / "llm-tool-debug"
OUT_DIR = DEBUG_DIR / os.environ.get("LOCAL_LLM_OUT_DIR", "Local_LLM_Test")
REPORT_PATH = DEBUG_DIR / os.environ.get("LOCAL_LLM_REPORT", "本地LLM简略审查.md")
MODEL_PATH = Path(os.environ.get(
    "LOCAL_LLM_MODEL_PATH",
    ROOT / "tmp/local_llm/models/qwen2.5-0.5b-instruct-q4_k_m.gguf",
))
MODEL_NAME = os.environ.get("LOCAL_LLM_MODEL_NAME", "Qwen2.5-0.5B-Instruct Q4_K_M GGUF")
N_CTX = int(os.environ.get("LOCAL_LLM_N_CTX", "4096"))
N_THREADS = int(os.environ.get("LOCAL_LLM_N_THREADS", "6"))
N_GPU_LAYERS = int(os.environ.get("LOCAL_LLM_N_GPU_LAYERS", "0"))
CHAT_FORMAT = os.environ.get("LOCAL_LLM_CHAT_FORMAT", "chatml")
PROMPT_SUFFIX = os.environ.get("LOCAL_LLM_PROMPT_SUFFIX", "")
TEST_IDS = [item.strip() for item in os.environ.get("LOCAL_LLM_TEST_IDS", "").split(",") if item.strip()]
MAX_TOKENS_CAP = int(os.environ.get("LOCAL_LLM_MAX_TOKENS_CAP", "0"))

TEST_PLAN = [
    ("system.data.quantify_text", "简单数值量化", {"parse": True, "keys": ["field", "mode", "value"]}),
    ("system.item_registry.upsert_equipment", "装备数值量化", {"parse": True, "keys": ["field", "mode", "value"]}),
    ("system.mechanics_registry.upsert_status", "状态机制量化", {"parse": True, "keys": ["field", "mode", "value"]}),
    ("system.time.interpret_advance", "模糊耗时解释", {"parse": True, "keys": ["action", "confidence", "seconds"]}),
    ("system.quests.gate_relevance", "任务相关性判断", {"parse": True, "keys": ["relevant", "reason"]}),
    ("system.persuasion.judge_argument", "说服话术评分", {"parse": True, "keys": ["judgementId", "reasoningQuality", "argumentBonus"]}),
    ("system.combat.judge_start", "战斗开始判断", {"parse": True, "keys": ["shouldStartBattle", "participantIds"]}),
    ("system.action.judge_absurdity", "荒诞行动判断", {"parse": True, "keys": ["absurdityLevel", "canAttempt"]}),
    ("system.combat.judge_special_action", "特殊战斗动作路由", {"parse": True, "keys": ["actionMode", "combatAction"]}),
    ("system.action.plan", "行动计划生成", {"parse": True, "keys": ["actionId", "checks", "proposals"]}),
    ("system.quests.create_hook", "任务钩子生成", {"parse": True, "keys": ["questId", "objective", "successCriteria"]}),
    ("system.encounters.create_encounter", "遭遇生成", {"parse": True, "keys": ["encounterId", "objective", "resolutionCriteria"]}),
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = read_json(DEBUG_DIR / "manifest.json")
    by_tool = {entry["toolId"]: entry for entry in manifest["cases"]}

    llm = Llama(
        model_path=str(MODEL_PATH),
        n_ctx=N_CTX,
        n_threads=N_THREADS,
        n_gpu_layers=N_GPU_LAYERS,
        verbose=False,
        **({"chat_format": CHAT_FORMAT} if CHAT_FORMAT else {}),
    )

    results = []
    test_plan = [item for item in TEST_PLAN if not TEST_IDS or item[0] in TEST_IDS]
    for tool_id, purpose, expectation in test_plan:
        entry = by_tool[tool_id]
        calls = read_json(DEBUG_DIR / entry["directory"] / "llm_calls.json")
        call = calls[0]
        messages = apply_prompt_suffix(normalize_messages(call["request"].get("messages") or []))
        prompt_chars = sum(len(str(message.get("content", ""))) for message in messages)
        max_tokens = max_tokens_for(tool_id)
        started = time.time()
        try:
            completion = llm.create_chat_completion(
                messages=messages,
                temperature=0.1,
                top_p=0.9,
                max_tokens=max_tokens,
                stop=["<|im_end|>", "<|endoftext|>"],
            )
            elapsed = time.time() - started
            text = completion["choices"][0]["message"]["content"]
            parsed, parse_error = extract_json(text)
            key_status = check_keys(parsed, expectation["keys"])
            validation = validate_tool_output(tool_id, parsed, parse_error, key_status)
            quality = validation["quality"]
            results.append({
                "toolId": tool_id,
                "purpose": purpose,
                "promptChars": prompt_chars,
                "maxTokens": max_tokens,
                "elapsedSeconds": round(elapsed, 2),
                "rawText": text,
                "parsed": parsed,
                "parseError": parse_error,
                "requiredKeys": expectation["keys"],
                "missingKeys": key_status["missing"],
                "extraNotes": key_status["notes"],
                "validationIssues": validation["issues"],
                "quality": quality,
                "delegate": delegation(tool_id, quality),
            })
        except Exception as error:
            elapsed = time.time() - started
            results.append({
                "toolId": tool_id,
                "purpose": purpose,
                "promptChars": prompt_chars,
                "maxTokens": max_tokens,
                "elapsedSeconds": round(elapsed, 2),
                "rawText": "",
                "parsed": None,
                "parseError": f"{type(error).__name__}: {error}",
                "requiredKeys": expectation["keys"],
                "missingKeys": expectation["keys"],
                "extraNotes": [],
                "validationIssues": [f"{type(error).__name__}: {error}"],
                "quality": "失败",
                "delegate": "不能交给它",
            })

    summary = {
        "model": {
            "name": MODEL_NAME,
            "path": str(MODEL_PATH),
            "runtime": "llama-cpp-python",
            "nCtx": N_CTX,
            "nThreads": N_THREADS,
            "nGpuLayers": N_GPU_LAYERS,
            "chatFormat": CHAT_FORMAT or "gguf-template",
            "promptSuffix": PROMPT_SUFFIX,
        },
        "results": results,
    }
    (OUT_DIR / "raw_results.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT_PATH.write_text(render_report(summary), encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_messages(messages):
    normalized = []
    for message in messages:
        role = message.get("role") or "user"
        if role not in {"system", "user", "assistant"}:
            role = "user"
        normalized.append({"role": role, "content": str(message.get("content", ""))})
    return normalized


def apply_prompt_suffix(messages):
    if not PROMPT_SUFFIX:
        return messages
    adjusted = [dict(message) for message in messages]
    for index in range(len(adjusted) - 1, -1, -1):
        if adjusted[index].get("role") == "user":
            adjusted[index]["content"] = f"{adjusted[index].get('content', '')}\n\n{PROMPT_SUFFIX}"
            return adjusted
    adjusted.append({"role": "user", "content": PROMPT_SUFFIX})
    return adjusted


def max_tokens_for(tool_id):
    def capped(value):
        return min(value, MAX_TOKENS_CAP) if MAX_TOKENS_CAP > 0 else value
    if "create_hook" in tool_id or "create_encounter" in tool_id or tool_id.endswith(".plan"):
        return capped(700)
    if "judge_special_action" in tool_id or "judge_start" in tool_id or "persuasion" in tool_id:
        return capped(520)
    return capped(260)


def extract_json(text):
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.I).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    decoder = json.JSONDecoder()
    last_error = "没有找到 JSON"
    for index, char in enumerate(cleaned):
        if char not in "{[":
            continue
        try:
            parsed, _ = decoder.raw_decode(cleaned[index:])
            return parsed, ""
        except Exception as error:
            last_error = str(error)
            if index == 0:
                return None, last_error
    try:
        return json.loads(cleaned), ""
    except Exception as error:
        return None, str(error) if cleaned else last_error


def check_keys(parsed, required):
    if not isinstance(parsed, dict):
        return {"missing": required, "notes": ["输出不是 JSON object。"]}
    missing = [key for key in required if key not in parsed]
    notes = []
    if len(parsed.keys()) <= 2:
        notes.append("字段过少。")
    if any(isinstance(value, str) and len(value) > 900 for value in parsed.values()):
        notes.append("存在过长字符串字段。")
    return {"missing": missing, "notes": notes}


def validate_tool_output(tool_id, parsed, parse_error, key_status):
    issues = []
    if parse_error:
        return {"quality": "失败", "issues": [parse_error]}
    if not isinstance(parsed, dict):
        return {"quality": "不可靠", "issues": ["输出不是 JSON object。"]}
    if key_status["missing"]:
        issues.append("缺字段：" + "、".join(key_status["missing"]))

    if tool_id == "system.data.quantify_text":
        if parsed.get("field") != "dc" or parsed.get("value") != 15:
            issues.append("没有正确抽取明确 DC 15。")
        return graded(issues)

    if tool_id == "system.item_registry.upsert_equipment":
        if parsed.get("field") != "armorBonus":
            issues.append("字段不是 armorBonus。")
        if parsed.get("value") != 1:
            issues.append("源文本是 +1 AC，但模型没有输出 1。")
        return graded(issues)

    if tool_id == "system.mechanics_registry.upsert_status":
        if parsed.get("field") != "dc" or parsed.get("value") != 15:
            issues.append("没有正确抽取施加状态 DC 15。")
        return graded(issues)

    if tool_id == "system.time.interpret_advance":
        if parsed.get("action") != "advance_time":
            issues.append("应为 advance_time。")
        seconds = parsed.get("seconds")
        if not isinstance(seconds, (int, float)) or not 60 <= seconds <= 900:
            issues.append("seconds 应为数分钟量级。")
        return {"quality": "可用" if not issues else "不可靠", "issues": issues}

    if tool_id == "system.quests.gate_relevance":
        relevance_wrong = parsed.get("relevant") not in (True, 1, "1", "true", "True")
        if relevance_wrong:
            issues.append("没有正确判定相关。")
        quest_wrong = "quest_silver_bell" not in as_list(parsed.get("questIds"))
        if quest_wrong:
            issues.append("没有指向 quest_silver_bell。")
        if not isinstance(parsed.get("relevant"), bool):
            issues.append("relevant 类型不是 boolean，需要 schema 归一化。")
        if relevance_wrong or quest_wrong:
            return {"quality": "不可靠", "issues": issues}
        return {"quality": "可用" if not issues else "勉强可用", "issues": issues}

    if tool_id == "system.persuasion.judge_argument":
        if parsed.get("targetNpcId") != "npc_guard_elowen":
            issues.append("targetNpcId 错误或仍是模板占位。")
        if parsed.get("speakerId") != "pc_arin":
            issues.append("speakerId 错误或仍是模板占位。")
        if contains_template_pipe(parsed):
            issues.append("输出保留了模板枚举占位。")
        if not isinstance(parsed.get("argumentBonus"), (int, float)):
            issues.append("argumentBonus 不是数值。")
        combined = json.dumps(parsed, ensure_ascii=False)
        if "偏向密教" in combined or "密教利益冲突" in combined:
            issues.append("把守门卫兵误判为偏向密教，核心语义反向。")
        return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}

    if tool_id == "system.combat.judge_start":
        if "npc_wight_captain" not in as_list(parsed.get("participantIds")):
            issues.append("参战者缺少尸妖队长。")
        if "npc_wight_captain" not in as_list(parsed.get("enemyIds")):
            issues.append("敌方缺少尸妖队长。")
        if contains_template_pipe(parsed):
            issues.append("输出保留了模板枚举占位。")
        return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}

    if tool_id == "system.action.judge_absurdity":
        if parsed.get("absurdityLevel") not in {"ordinary", "unlikely", "absurdButPossible", "impossibleButPlayable", "impossibleAndRejected"}:
            issues.append("absurdityLevel 缺失或非法。")
        if not isinstance(parsed.get("canAttempt"), bool):
            issues.append("canAttempt 缺失或不是 boolean。")
        return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}

    if tool_id == "system.combat.judge_special_action":
        action = parsed.get("combatAction") if isinstance(parsed.get("combatAction"), dict) else {}
        if "npc_wight_captain" not in as_list(action.get("targetIds")):
            issues.append("目标没有指向尸妖队长。")
        if contains_template_pipe(parsed):
            issues.append("输出保留了模板枚举占位。")
        return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}

    if tool_id == "system.action.plan":
        if "actionId" not in parsed or not isinstance(parsed.get("checks"), list) or not isinstance(parsed.get("proposals"), list):
            issues.append("没有形成可执行行动计划。")
            return {"quality": "不可靠", "issues": issues}
        if "${" in json.dumps(parsed, ensure_ascii=False):
            issues.append("输出含占位符，不能直接执行。")
        return {"quality": "勉强可用", "issues": issues}

    if tool_id == "system.quests.create_hook":
        if not isinstance(parsed.get("successCriteria"), list):
            issues.append("successCriteria 应为数组。")
        if not isinstance(parsed.get("evidenceSlots"), list) or not all(isinstance(item, dict) for item in parsed.get("evidenceSlots", [])):
            issues.append("evidenceSlots 应为对象数组。")
        if not isinstance(parsed.get("investigationBudget"), (int, float)):
            issues.append("investigationBudget 应为数字。")
        return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}

    if tool_id == "system.encounters.create_encounter":
        if not isinstance(parsed.get("resolutionCriteria"), list):
            issues.append("resolutionCriteria 应为数组。")
        if not isinstance(parsed.get("rewardHints"), list):
            issues.append("rewardHints 应为数组。")
        if not isinstance(parsed.get("failureImpact"), dict):
            issues.append("failureImpact 应为对象。")
        if not isinstance(parsed.get("resolutionBudget"), (int, float)):
            issues.append("resolutionBudget 应为数字。")
        return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}

    return {"quality": "勉强可用" if not issues else "不可靠", "issues": issues}


def graded(issues):
    return {"quality": "可用" if not issues else "不可靠", "issues": issues}


def delegation(tool_id, quality):
    if quality == "可用":
        return "可以交给它，但要保留 schema 校验"
    if quality == "勉强可用":
        if tool_id in {"system.combat.judge_start", "system.action.judge_absurdity", "system.persuasion.judge_argument"}:
            return "只能交给它做草稿，必须由规则层校验"
        return "不建议直接交给它，只能做参考草稿"
    return "不能交给它"


def as_list(value):
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def contains_template_pipe(value):
    if isinstance(value, str):
        return "|" in value
    if isinstance(value, list):
        return any(contains_template_pipe(item) for item in value)
    if isinstance(value, dict):
        return any(contains_template_pipe(item) for item in value.values())
    return False


def render_report(summary):
    results = summary["results"]
    ok = [item for item in results if item["quality"] == "可用"]
    draft = [item for item in results if item["quality"] == "勉强可用"]
    bad = [item for item in results if item["quality"] in {"不可靠", "失败"}]
    ok_ids = "、".join(f"`{item['toolId']}`" for item in ok) or "无"
    draft_ids = "、".join(f"`{item['toolId']}`" for item in draft) or "无"
    bad_ids = "、".join(f"`{item['toolId']}`" for item in bad) or "无"
    ok_scope = "明文单字段数字抽取；本次也能处理一条短文本模糊耗时，但必须保留上限/下限校验。"
    if not ok:
        ok_scope = "无；本次没有任何工具通过严格检查。"
    if not any(item["toolId"] == "system.time.interpret_advance" for item in ok):
        ok_scope = "明文单字段数字抽取，例如 DC、次数、显式加值；仍要保留 schema 校验。"
    if not ok:
        ok_scope = "无；本次没有任何工具通过严格检查。"
    bad_purposes = "、".join(dict.fromkeys(item["purpose"] for item in bad)) or "无"
    lines = [
        "# 本地 LLM 简略审查",
        "",
        "## 运行结论",
        "",
        f"- 模型：{summary['model']['name']}",
        f"- 运行方式：{summary['model']['runtime']}，n_ctx={summary['model']['nCtx']}，CPU 线程={summary['model']['nThreads']}，GPU layers={summary['model'].get('nGpuLayers', 0)}",
        *([f"- 模型选择说明：{summary['model']['note']}"] if summary["model"].get("note") else []),
        f"- 测试工具数：{len(results)}",
        f"- 可用：{len(ok)}",
        f"- 勉强可用：{len(draft)}",
        f"- 不可靠/失败：{len(bad)}",
        "- 说明：代表性输出摘录保留本地模型原文，英文 reason 是本次效果问题之一。",
        "",
    ]
    comparison = summary.get("comparison")
    if comparison:
        lines.extend([
            "## 与上一版本地模型对比",
            "",
            f"- 上一版：{comparison['baselineName']}，可用 {comparison['baselineUsable']}，草稿 {comparison['baselineDraft']}，不可靠/失败 {comparison['baselineBad']}，总耗时约 {comparison['baselineSeconds']} 秒。",
            f"- 本版：{summary['model']['name']}，可用 {len(ok)}，草稿 {len(draft)}，不可靠/失败 {len(bad)}，总耗时约 {comparison['currentSeconds']} 秒。",
            f"- 结论：{comparison.get('conclusion', '质量略有变化；复杂裁定仍需高阶模型或人工复核。')}",
            "",
        ])
    lines.extend([
        "## 可以交给它",
        "",
        f"- 本次严格检查通过：{ok_ids}。",
        f"- 适合范围：{ok_scope}",
        "",
        "## 只能当参考草稿",
        "",
        f"- 本次勉强可用：{draft_ids}。",
        "- 这类结果语义可能对，但类型和值仍需要规则层归一化。",
        "",
        "## 不建议直接交给它",
        "",
        f"- 本次不可靠/失败：{bad_ids}。",
        f"- 本次不应直接委托的类别：{bad_purposes}。",
        "- 会生成复杂下游调用的工具：`system.action.plan`、`system.action.resolve`、`system.npc_behavior.resolve`。",
        "- 可以让它产出草稿，但必须经过 schema 校验、规则层归一化和人工/高阶模型复核。",
        "",
        "## 逐项结果",
        "",
        "| 工具 | 用途 | 结果 | 委派建议 | 耗时 | 关键问题 |",
        "|---|---|---|---|---:|---|",
    ])
    for item in results:
        issues = item.get("validationIssues") or []
        problem = item["parseError"] or ("；".join(issues) if issues else "无")
        lines.append(
            f"| `{item['toolId']}` | {item['purpose']} | {item['quality']} | {item['delegate']} | {item['elapsedSeconds']}s | {problem} |"
        )
    sample_ids = [
        "system.data.quantify_text",
        "system.item_registry.upsert_equipment",
        "system.time.interpret_advance",
        "system.action.judge_absurdity",
        "system.action.plan",
    ]
    sample_items = [item for item in results if item["toolId"] in sample_ids]
    lines.extend(["", "## 代表性输出摘录", ""])
    for item in sample_items:
        output = item["parsed"] if item["parsed"] is not None else {"raw": item["rawText"], "error": item["parseError"]}
        lines.extend([
            f"### {item['toolId']}",
            "",
            f"- prompt 长度：{item['promptChars']} 字符",
            f"- 质量：{item['quality']}",
            f"- 委派建议：{item['delegate']}",
            "",
            "```json",
            json.dumps(output, ensure_ascii=False, indent=2)[:1200],
            "```",
            "",
        ])
    return "\n".join(lines)


if __name__ == "__main__":
    main()
