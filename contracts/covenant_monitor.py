# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Covenant monitor: reads the evidence, judges the promise, triggers the consequence.

Anyone may call ``test_covenant``. In practice an off-chain scheduler calls it
on the cadence the covenant itself specifies.

The split that makes this work:

* An LLM only ever **extracts named figures and cites where it found them**.
  It is never asked to do arithmetic and never asked for a verdict.
* The arithmetic and the threshold comparison run inside
  ``gl.vm.spawn_sandbox()`` in deterministic context, so the numeric test is
  exact. Only the extraction is subject to judgement.
* Validators re-fetch the same sources, re-extract, and must agree on the
  figures, on the ratio within tolerance, on the breach boolean, and on the
  identifier of the artifact relied upon. Agreeing on a conclusion without
  agreeing on the source is the failure mode this guards against.

Treasury covenants skip the LLM entirely: they read chain state over RPC under
``strict_eq``, which is exactly reproducible.
"""

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from genlayer import *

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

KIND_RATIO = "ratio"
KIND_FILING = "filing"
KIND_PROSE = "prose"
KIND_TREASURY = "treasury"

COMPARATOR_GTE = "gte"
COMPARATOR_LTE = "lte"

COVENANT_COMPLIANT = "compliant"
COVENANT_PENDING_CURE = "breach_pending_cure"
COVENANT_BREACHED = "breached"
COVENANT_CURED = "cured"

CONSEQUENCE_DRAW_STOP = "draw_stop"
CONSEQUENCE_RATE_STEP_UP = "rate_step_up"
CONSEQUENCE_ACCELERATION = "acceleration"

APPEAL_NONE = "none"
APPEAL_OPEN = "open"
APPEAL_UPHELD = "upheld"
APPEAL_OVERTURNED = "overturned"

FACILITY_CLOSED = "closed"

# Ratios are compared in basis points of 1.0x, so 12000 means 1.2x.
BP_ONE = 10000
# Figures are normalised to thousandths so two extractions can be compared as
# integers without float equality games.
MILLI = 1000
# Validators may disagree on a computed ratio by at most this, in basis points
# of the ratio itself. 50 bp of the reading is the 0.5% tolerance.
RATIO_TOLERANCE_BP = 50

ZERO_ADDRESS = Address("0x" + "00" * 20)

_NUMBER_PATTERN = re.compile(r"-?\d[\d,_\s]*(?:\.\d+)?")
_SUFFIXES = {
    "k": 1_000.0,
    "thousand": 1_000.0,
    "m": 1_000_000.0,
    "mm": 1_000_000.0,
    "million": 1_000_000.0,
    "b": 1_000_000_000.0,
    "bn": 1_000_000_000.0,
    "billion": 1_000_000_000.0,
    "t": 1_000_000_000_000.0,
    "trillion": 1_000_000_000_000.0,
}


# --------------------------------------------------------------------- time


def parse_iso(value: str) -> datetime:
    text = str(value).strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def block_now() -> str:
    return format_iso(parse_iso(str(gl.message_raw["datetime"])))


def shift_hours(stamp: str, hours: int) -> str:
    return format_iso(parse_iso(stamp) + timedelta(hours=int(hours)))


def days_between(earlier: str, later: str) -> int:
    return int((parse_iso(later) - parse_iso(earlier)).total_seconds() // 86400)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")


# ------------------------------------------------------------------ parsing


def to_milli(raw: object) -> int:
    """Turn whatever the model returned into thousandths of a unit.

    Handles plain numbers, thousands separators, and the shorthand that shows
    up in financial writing such as ``$12.4m`` or ``1.2 billion``.
    """
    if isinstance(raw, bool):
        raise gl.vm.UserError(f"{ERROR_LLM} expected a figure, got a boolean")
    if isinstance(raw, (int, float)):
        return int(round(float(raw) * MILLI))

    text = str(raw).strip().lower()
    if len(text) == 0:
        raise gl.vm.UserError(f"{ERROR_LLM} figure was blank")

    match = _NUMBER_PATTERN.search(text)
    if match is None:
        raise gl.vm.UserError(f"{ERROR_LLM} no number inside {text[:48]!r}")

    digits = match.group(0).replace(",", "").replace("_", "").replace(" ", "")
    try:
        value = float(digits)
    except ValueError:
        raise gl.vm.UserError(f"{ERROR_LLM} cannot read {digits!r} as a number")

    tail = text[match.end():].strip()
    tail = tail.lstrip("$ ").strip()
    for token in re.findall(r"[a-z]+", tail)[:1]:
        if token in _SUFFIXES:
            value = value * _SUFFIXES[token]
            break

    if text.lstrip().startswith("(") and text.rstrip().endswith(")"):
        value = -value

    return int(round(value * MILLI))


def parse_json_block(text: str) -> dict:
    """Pull a JSON object out of a model response that may be wrapped in prose."""
    first = text.find("{")
    last = text.rfind("}")
    if first < 0 or last <= first:
        raise gl.vm.UserError(f"{ERROR_LLM} response held no JSON object")
    body = text[first : last + 1]
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    try:
        parsed = json.loads(body)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_LLM} JSON would not parse")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} expected an object, got {type(parsed).__name__}")
    return parsed


def pick(payload: dict, *names: str) -> object:
    """First present key out of a list of acceptable names."""
    for name in names:
        if name in payload and payload[name] is not None:
            return payload[name]
    return None


def normalise_citation(value: object) -> str:
    """Collapse a cited artifact reference to a comparable token.

    Validators have to agree on *which* document they relied on, so this strips
    the incidental differences (case, spacing, trailing punctuation, tracking
    query strings) while keeping the identifying part.
    """
    text = str(value or "").strip().lower()
    text = text.split("#")[0]
    if "?" in text:
        head, _, tail = text.partition("?")
        keep = [
            part
            for part in tail.split("&")
            if part and not part.split("=")[0].startswith("utm_")
        ]
        text = head if len(keep) == 0 else head + "?" + "&".join(sorted(keep))
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^www\.", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.rstrip("/ .,;:")


def format_scaled(value: int, scale: int, places: int) -> str:
    """Render a scaled integer as a decimal string, without touching floats."""
    sign = "-" if value < 0 else ""
    magnitude = abs(int(value))
    whole = magnitude // scale
    if places <= 0:
        return f"{sign}{whole}"
    remainder = magnitude % scale
    digits = str(remainder * (10**places) // scale).rjust(places, "0")
    return f"{sign}{whole}.{digits}"


def ratio_bp(numerator_milli: int, denominator_milli: int) -> int:
    """The whole numeric test, as plain integer arithmetic."""
    if denominator_milli == 0:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} denominator came back as zero")
    return int((numerator_milli * BP_ONE) // denominator_milli)


def breaches(observed: int, threshold: int, comparator: str) -> bool:
    if comparator == COMPARATOR_GTE:
        return observed < threshold
    return observed > threshold


def within_tolerance(left: int, right: int, tolerance_bp: int) -> bool:
    if left == right:
        return True
    larger = max(abs(left), abs(right))
    if larger == 0:
        return True
    drift = abs(left - right) * BP_ONE // larger
    return drift <= tolerance_bp


# ------------------------------------------------------------ source access


def load_source(url: str) -> str:
    """Fetch one evidence source as text.

    JSON endpoints come back raw so figures stay machine readable. Everything
    else is rendered, which is what a published dashboard or report needs.
    """
    lowered = url.lower()
    is_json = (
        lowered.endswith(".json")
        or "/api/" in lowered
        or lowered.endswith("/graphql")
        or "format=json" in lowered
    )
    if is_json:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
        status = int(getattr(response, "status", 0) or 0)
        if 400 <= status < 500:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} {url} returned {status}")
        if status >= 500:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} {url} returned {status}")
        body = getattr(response, "body", None) or b""
        return body.decode("utf-8", errors="replace")
    return str(gl.nondet.web.render(url, mode="text"))


def gather_sources(urls: list) -> list:
    collected = []
    for url in urls:
        collected.append({"url": url, "body": load_source(url)[:24000]})
    if len(collected) == 0:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} this covenant has no sources to read")
    return collected


def render_sources(sources: list) -> str:
    parts = []
    for item in sources:
        parts.append(f"SOURCE {item['url']}\n{item['body']}")
    return "\n\n".join(parts)


# -------------------------------------------------------------- extractions


def extract_ratio_figures(
    urls: list, numerator_label: str, denominator_label: str, covenant_text: str
) -> dict:
    """Leader side of a ratio covenant. Extraction only, never arithmetic."""
    sources = gather_sources(urls)
    prompt = (
        "You are reading published financial disclosures for a lender who needs two "
        "specific figures. Do not calculate anything. Do not form an opinion on "
        "compliance. Extract only.\n\n"
        f"COVENANT UNDER TEST: {covenant_text}\n\n"
        f"FIGURE A, the numerator: {numerator_label}\n"
        f"FIGURE B, the denominator: {denominator_label}\n\n"
        f"{render_sources(sources)}\n\n"
        "Return JSON with exactly these keys:\n"
        '  "numerator": the value of figure A as a plain number, no currency symbol\n'
        '  "denominator": the value of figure B as a plain number\n'
        '  "unit": the unit both figures are expressed in\n'
        '  "citation": the exact URL of the source you took the figures from\n'
        '  "locator": the heading, label or line item the figures sit under\n'
        '  "as_of": the date the figures are stated as of, ISO 8601\n'
        '  "notes": one short sentence on anything ambiguous\n\n'
        "Both figures must come from the same source. If a figure genuinely is not "
        'present, set it to null and explain in "notes".'
    )
    answer = gl.nondet.exec_prompt(prompt, response_format="json")
    if not isinstance(answer, dict):
        answer = parse_json_block(str(answer))

    numerator_raw = pick(answer, "numerator", "figure_a", "a", "value_a")
    denominator_raw = pick(answer, "denominator", "figure_b", "b", "value_b")
    if numerator_raw is None or denominator_raw is None:
        raise gl.vm.UserError(
            f"{ERROR_LLM} could not find both figures. keys: {sorted(answer.keys())}"
        )

    citation = pick(answer, "citation", "source", "source_url", "url") or urls[0]
    return {
        "numerator_milli": to_milli(numerator_raw),
        "denominator_milli": to_milli(denominator_raw),
        "unit": str(pick(answer, "unit", "units") or "").strip()[:64],
        "citation": normalise_citation(citation),
        "locator": str(pick(answer, "locator", "label", "line_item") or "").strip()[:160],
        "as_of": str(pick(answer, "as_of", "as_of_date", "date") or "").strip()[:40],
        "notes": str(pick(answer, "notes", "note", "comment") or "").strip()[:320],
    }


def extract_filing_dates(urls: list, covenant_text: str, deadline_days: int) -> dict:
    """Leader side of a filing timeliness covenant."""
    sources = gather_sources(urls)
    prompt = (
        "You are checking whether a borrower published a periodic report on time. "
        "Report dates only. Do not judge compliance.\n\n"
        f"COVENANT UNDER TEST: {covenant_text}\n"
        f"The report is due within {deadline_days} days of the period end.\n\n"
        f"{render_sources(sources)}\n\n"
        "Return JSON with exactly these keys:\n"
        '  "period_end": the end date of the most recent period reported on, ISO 8601\n'
        '  "published_at": the date that report was published, ISO 8601, or null if '
        "no report for that period has been published yet\n"
        '  "report_title": the title of that report\n'
        '  "citation": the exact URL where you found it\n'
        '  "notes": one short sentence on anything ambiguous'
    )
    answer = gl.nondet.exec_prompt(prompt, response_format="json")
    if not isinstance(answer, dict):
        answer = parse_json_block(str(answer))

    period_end = str(pick(answer, "period_end", "period", "period_ended") or "").strip()
    if len(period_end) == 0:
        raise gl.vm.UserError(f"{ERROR_LLM} no period end date in the response")

    published_raw = pick(answer, "published_at", "published", "publication_date", "filed_at")
    published_at = str(published_raw or "").strip()
    citation = pick(answer, "citation", "source", "source_url", "url") or urls[0]
    return {
        "period_end": period_end[:40],
        "published_at": published_at[:40],
        "report_title": str(pick(answer, "report_title", "title") or "").strip()[:160],
        "citation": normalise_citation(citation),
        "notes": str(pick(answer, "notes", "note") or "").strip()[:320],
    }


def extract_prose_finding(urls: list, covenant_text: str) -> dict:
    """Leader side of a prose covenant such as 'incur no new senior debt'.

    For a DAO this is decided in governance, so the answer has to name the
    proposal or post it rests on. A conclusion with no artifact behind it is
    treated as a failed extraction.
    """
    sources = gather_sources(urls)
    prompt = (
        "You are a credit analyst checking one written promise against a borrower's "
        "published governance record.\n\n"
        f"THE PROMISE: {covenant_text}\n\n"
        f"{render_sources(sources)}\n\n"
        "Decide whether the promise still holds based only on what is in these "
        "sources. Return JSON with exactly these keys:\n"
        '  "holds": true if the promise still holds, false if it has been broken\n'
        '  "artifact_id": the identifier of the single most decisive proposal, post '
        "or decision you relied on. Use its number or slug if it has one, otherwise "
        "its exact title. If the promise holds because nothing relevant was found, "
        'use the string "no-contrary-record"\n'
        '  "artifact_title": the title of that artifact\n'
        '  "artifact_date": its date, ISO 8601\n'
        '  "citation": the exact URL you relied on\n'
        '  "reasoning": two sentences at most, quoting the decisive wording'
    )
    answer = gl.nondet.exec_prompt(prompt, response_format="json")
    if not isinstance(answer, dict):
        answer = parse_json_block(str(answer))

    holds_raw = pick(answer, "holds", "satisfied", "compliant", "still_holds")
    if holds_raw is None:
        raise gl.vm.UserError(
            f"{ERROR_LLM} no verdict field. keys: {sorted(answer.keys())}"
        )
    if isinstance(holds_raw, str):
        lowered = holds_raw.strip().lower()
        if lowered in ("true", "yes", "holds", "satisfied", "compliant"):
            holds = True
        elif lowered in ("false", "no", "broken", "breached", "violated"):
            holds = False
        else:
            raise gl.vm.UserError(f"{ERROR_LLM} cannot read verdict {holds_raw!r}")
    else:
        holds = bool(holds_raw)

    artifact = pick(answer, "artifact_id", "artifact", "proposal_id", "identifier")
    if artifact is None or len(str(artifact).strip()) == 0:
        raise gl.vm.UserError(f"{ERROR_LLM} verdict given with no artifact cited")

    citation = pick(answer, "citation", "source", "source_url", "url") or urls[0]
    return {
        "holds": holds,
        "artifact_id": normalise_citation(artifact),
        "artifact_title": str(pick(answer, "artifact_title", "title") or "").strip()[:200],
        "artifact_date": str(pick(answer, "artifact_date", "date") or "").strip()[:40],
        "citation": normalise_citation(citation),
        "reasoning": str(pick(answer, "reasoning", "reason", "analysis") or "").strip()[:600],
    }


# -------------------------------------------------------------- validators


def errors_agree(leader_msg: str, validator_err: Exception) -> bool:
    """Compare failure paths.

    A deterministic error has to match word for word, because both sides should
    have hit the same wall. A transient error only needs both sides to have hit
    something transient. Anything else disagrees, which rotates the leader
    rather than letting a broken reading settle.
    """
    validator_msg = str(getattr(validator_err, "message", "") or str(validator_err))
    if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
        return validator_msg == leader_msg
    if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
        return True
    return False


def ratio_validator(leaders_res, urls, numerator_label, denominator_label,
                    covenant_text, threshold_bp, comparator) -> bool:
    """Validator for a ratio covenant.

    Agreement requires the same breach boolean, a ratio inside the tolerance,
    and figures that either match exactly once normalised or at least land
    inside the tolerance themselves. The breach boolean is the gate, because
    that is the part money depends on. The cited source has to match too, so a
    validator cannot agree with a conclusion it reached from somewhere else.
    """
    if not isinstance(leaders_res, gl.vm.Return):
        return ratio_error_agrees(
            leaders_res, urls, numerator_label, denominator_label, covenant_text
        )

    leader = leaders_res.calldata
    if not isinstance(leader, dict):
        return False

    try:
        mine = extract_ratio_figures(
            urls, numerator_label, denominator_label, covenant_text
        )
        leader_num = int(leader["numerator_milli"])
        leader_den = int(leader["denominator_milli"])
        leader_bp = ratio_bp(leader_num, leader_den)
        mine_bp = ratio_bp(mine["numerator_milli"], mine["denominator_milli"])
    except Exception:
        return False

    if not within_tolerance(leader_bp, mine_bp, RATIO_TOLERANCE_BP):
        return False

    if breaches(leader_bp, threshold_bp, comparator) != breaches(
        mine_bp, threshold_bp, comparator
    ):
        return False

    figures_agree = (
        leader_num == mine["numerator_milli"] and leader_den == mine["denominator_milli"]
    )
    if not figures_agree:
        # Two honest reads of a live dashboard can differ in the last digit.
        # Tolerated only while the ratio and the verdict still line up, which
        # the checks above have already established.
        if not within_tolerance(leader_num, mine["numerator_milli"], RATIO_TOLERANCE_BP):
            return False
        if not within_tolerance(leader_den, mine["denominator_milli"], RATIO_TOLERANCE_BP):
            return False

    return normalise_citation(leader.get("citation")) == mine["citation"]


def ratio_error_agrees(leaders_res, urls, numerator_label, denominator_label,
                       covenant_text) -> bool:
    leader_msg = str(getattr(leaders_res, "message", "") or "")
    try:
        extract_ratio_figures(urls, numerator_label, denominator_label, covenant_text)
        return False
    except gl.vm.UserError as err:
        return errors_agree(leader_msg, err)
    except Exception:
        return False


def filing_validator(leaders_res, urls, covenant_text, deadline_days) -> bool:
    if not isinstance(leaders_res, gl.vm.Return):
        return filing_error_agrees(leaders_res, urls, covenant_text, deadline_days)

    leader = leaders_res.calldata
    if not isinstance(leader, dict):
        return False
    try:
        mine = extract_filing_dates(urls, covenant_text, deadline_days)
    except Exception:
        return False

    if str(leader.get("period_end", ""))[:10] != mine["period_end"][:10]:
        return False
    if str(leader.get("published_at", ""))[:10] != mine["published_at"][:10]:
        return False
    return normalise_citation(leader.get("citation")) == mine["citation"]


def filing_error_agrees(leaders_res, urls, covenant_text, deadline_days) -> bool:
    leader_msg = str(getattr(leaders_res, "message", "") or "")
    try:
        extract_filing_dates(urls, covenant_text, deadline_days)
        return False
    except gl.vm.UserError as err:
        return errors_agree(leader_msg, err)
    except Exception:
        return False


def prose_validator(leaders_res, urls, covenant_text) -> bool:
    if not isinstance(leaders_res, gl.vm.Return):
        return prose_error_agrees(leaders_res, urls, covenant_text)

    leader = leaders_res.calldata
    if not isinstance(leader, dict):
        return False
    try:
        mine = extract_prose_finding(urls, covenant_text)
    except Exception:
        return False

    if bool(leader.get("holds")) != mine["holds"]:
        return False
    return normalise_citation(leader.get("artifact_id")) == mine["artifact_id"]


def prose_error_agrees(leaders_res, urls, covenant_text) -> bool:
    leader_msg = str(getattr(leaders_res, "message", "") or "")
    try:
        extract_prose_finding(urls, covenant_text)
        return False
    except gl.vm.UserError as err:
        return errors_agree(leader_msg, err)
    except Exception:
        return False


# ------------------------------------------------------------------ storage


@allow_storage
@dataclass
class Finding:
    facility_id: str
    covenant_index: u256
    kind: str
    tested_at: str
    breached: bool
    status: str
    observed_bp: u256
    observed_atto: u256
    numerator_milli: u256
    denominator_milli: u256
    threshold_bp: u256
    citation: str
    locator: str
    as_of: str
    narrative: str
    consequence_applied: str
    sequence: u256


@gl.evm.contract_interface
class NativeRecipient:
    """EOA/chain-layer payout; external messages execute only at finalization."""
    class View:
        pass

    class Write:
        pass


class CovenantMonitor(gl.Contract):
    owner: Address
    agreed_facilities: TreeMap[str, str]
    agreed_covenants: TreeMap[str, str]
    registry: Address
    vault: Address
    findings: TreeMap[str, Finding]
    finding_keys: DynArray[str]
    finding_seen: TreeMap[str, bool]
    test_total: u256
    breach_total: u256
    appeal_bonds: TreeMap[str, u256]
    cure_deadlines: TreeMap[str, str]
    restrictions: TreeMap[str, str]
    facility_revisions: TreeMap[str, u256]
    appeal_revisions: TreeMap[str, u256]
    appeal_outcomes: TreeMap[str, str]

    def __init__(self, registry_address: str) -> None:
        self.owner = gl.message.sender_address
        self.registry = Address(registry_address)
        self.vault = ZERO_ADDRESS
        self.test_total = u256(0)
        self.breach_total = u256(0)

    @gl.public.write
    def receive_facility(self, terms_json: str) -> None:
        """Only registry's finalized messages may establish agreement terms."""
        require(gl.message.sender_address == self.registry, "only the registry can deliver agreement")
        terms = json.loads(terms_json)
        key = str(terms["facility_id"])
        if key in self.agreed_facilities:
            require(self.agreed_facilities[key] == terms_json, "agreement terms are immutable")
            return
        self.agreed_facilities[key] = terms_json

    @gl.public.write
    def receive_covenant(self, facility_id: str, covenant_index: int, params_json: str) -> None:
        """Persist exact consent only after its registry transaction finalizes."""
        require(gl.message.sender_address == self.registry, "only the registry can deliver consent")
        params = json.loads(params_json)
        require(params["facility_id"] == facility_id and int(params["covenant_index"]) == covenant_index,
                "consent does not match covenant")
        require(bool(params["borrower_authorized"]), "covenant is not authorized by borrower")
        key = finding_key(facility_id, covenant_index)
        if key in self.agreed_covenants:
            require(self.agreed_covenants[key] == params_json, "covenant terms are immutable")
            return
        self.agreed_covenants[key] = params_json

    # ---------------------------------------------------------------- wiring

    @gl.public.write
    def set_vault(self, vault_address: str) -> None:
        require(gl.message.sender_address == self.owner, "only the owner can set the vault")
        self.vault = Address(vault_address)

    @gl.public.write
    def set_registry(self, registry_address: str) -> None:
        require(gl.message.sender_address == self.owner, "only the owner can set the registry")
        self.registry = Address(registry_address)

    @gl.public.view
    def get_wiring(self) -> dict:
        return {
            "owner": self.owner.as_hex,
            "registry": self.registry.as_hex,
            "vault": self.vault.as_hex,
            "test_total": int(self.test_total),
            "breach_total": int(self.breach_total),
        }

    # ------------------------------------------------------------- the test

    @gl.public.write
    def test_covenant(self, facility_id: str, covenant_index: int) -> dict:
        """Run one covenant test and act on the outcome.

        Cross-contract reads happen before the non-deterministic block and
        cross-contract writes after it, because GenVM forbids them inside.
        """
        key = finding_key(facility_id.strip(), covenant_index)
        require(int(self.appeal_bonds.get(key, u256(0))) == 0,
                "resolve the open appeal before ordinary retesting")
        return self._test_covenant(facility_id.strip(), covenant_index, False)

    def _test_covenant(self, facility_id: str, covenant_index: int, under_appeal: bool) -> dict:
        params = self._read_parameters(facility_id, covenant_index)
        key = finding_key(facility_id, covenant_index)
        if key in self.findings:
            params["status"] = self.findings[key].status
            params["cure_deadline"] = self.cure_deadlines.get(key, "")
        require(
            params["facility_status"] != FACILITY_CLOSED,
            "this facility is closed",
        )
        require(
            bool(params.get("borrower_authorized", False)),
            "covenant is not authorized by borrower",
        )

        now = block_now()
        kind = str(params["kind"])
        urls = [str(u) for u in params["source_urls"]]
        comparator = str(params["comparator"])
        threshold_bp = int(params["threshold_bp"])

        if kind == KIND_TREASURY:
            reading = self._measure_treasury(params)
        elif kind == KIND_RATIO:
            reading = self._measure_ratio(
                urls,
                str(params["numerator_label"]),
                str(params["denominator_label"]),
                str(params["text"]),
                threshold_bp,
                comparator,
            )
        elif kind == KIND_FILING:
            reading = self._measure_filing(
                urls, str(params["text"]), int(params["filing_deadline_days"]), now
            )
        elif kind == KIND_PROSE:
            reading = self._measure_prose(urls, str(params["text"]))
        else:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} cannot test a {kind} covenant")

        status = derive_status(
            breached=bool(reading["breached"]),
            prior_status=str(params["status"]),
            cure_deadline=str(params["cure_deadline"]),
            cure_period_hours=int(params["cure_period_hours"]),
            now=now,
        )

        consequence = consequence_for(
            status=status,
            configured=str(params["breach_consequence"]),
        )

        if status == COVENANT_PENDING_CURE and not self.cure_deadlines.get(key, ""):
            self.cure_deadlines[key] = shift_hours(now, int(params["cure_period_hours"]))
        elif status in (COVENANT_COMPLIANT, COVENANT_CURED):
            self.cure_deadlines[key] = ""
        prior_restriction = self.restrictions.get(key, "")
        if prior_restriction == CONSEQUENCE_ACCELERATION and not under_appeal:
            consequence = CONSEQUENCE_ACCELERATION
        self.restrictions[key] = consequence
        self._persist(facility_id, covenant_index, kind, now, reading, status,
                      threshold_bp, consequence)
        self._settle(facility_id, covenant_index, status, reading, consequence)

        return {
            "facility_id": facility_id,
            "covenant_index": int(covenant_index),
            "kind": kind,
            "tested_at": now,
            "status": status,
            "breached": bool(reading["breached"]),
            "observed_bp": int(reading["observed_bp"]),
            "observed_atto": str(int(reading["observed_atto"])),
            "threshold_bp": threshold_bp,
            "citation": str(reading["citation"]),
            "narrative": str(reading["narrative"]),
            "consequence_applied": consequence,
        }

    # -------------------------------------------------------------- appeals

    @gl.public.write.payable
    def appeal_breach(self, facility_id: str, covenant_index: int) -> dict:
        """Dispute a finding by posting a bond.

        The cure clock keeps running while the appeal is open, so a wrong
        acceleration stays recoverable. That mirrors how a real credit
        agreement handles a disputed breach notice.
        """
        facility_id = facility_id.strip()
        key = finding_key(facility_id, covenant_index)
        require(key in self.findings, "there is no finding to appeal")
        params = self._read_parameters(facility_id, covenant_index)
        params["status"] = self.findings[key].status
        facility = self._read_facility(facility_id)
        require(
            gl.message.sender_address == Address(str(facility["borrower"])),
            "only the borrower can appeal",
        )
        require(
            str(params["status"]) in (COVENANT_PENDING_CURE, COVENANT_BREACHED) or
            self.restrictions.get(key, "") == CONSEQUENCE_ACCELERATION,
            "there is no finding to appeal",
        )
        bond = int(gl.message.value)
        require(bond > 0, "an appeal needs a bond")

        key = finding_key(facility_id, covenant_index)
        self.appeal_bonds[key] = u256(int(self.appeal_bonds.get(key, u256(0))) + bond)

        revision = int(self.appeal_revisions.get(key, u256(0))) + 1
        self.appeal_revisions[key] = u256(revision)
        self.appeal_outcomes[key] = APPEAL_OPEN
        gl.get_contract_at(self.registry).emit(on="finalized").record_appeal(
            facility_id, int(covenant_index), APPEAL_OPEN, int(self.appeal_bonds[key]), revision
        )
        return {
            "facility_id": facility_id,
            "covenant_index": int(covenant_index),
            "appeal_status": APPEAL_OPEN,
            "bond_atto": str(int(self.appeal_bonds[key])),
        }

    @gl.public.write
    def resolve_appeal(self, facility_id: str, covenant_index: int) -> dict:
        """Retest under appeal and settle the bond.

        A retest that clears the covenant overturns the finding and returns the
        bond. A retest that confirms it upholds the finding and the bond goes to
        the lender, which is what stops appeals being free.
        """
        facility_id = facility_id.strip()
        key = finding_key(facility_id, covenant_index)
        bond = int(self.appeal_bonds.get(key, u256(0)))
        require(bond > 0, "no appeal is open on this covenant")

        outcome = self._test_covenant(facility_id.strip(), covenant_index, True)
        facility = self._read_facility(facility_id)
        upheld = bool(outcome["breached"])

        self.appeal_bonds[key] = u256(0)
        recipient = Address(str(facility["lender"])) if upheld else Address(
            str(facility["borrower"])
        )
        NativeRecipient(recipient).emit_transfer(value=u256(bond))

        revision = int(self.appeal_revisions.get(key, u256(0))) + 1
        self.appeal_revisions[key] = u256(revision)
        self.appeal_outcomes[key] = APPEAL_UPHELD if upheld else APPEAL_OVERTURNED
        gl.get_contract_at(self.registry).emit(on="finalized").record_appeal(
            facility_id,
            int(covenant_index),
            APPEAL_UPHELD if upheld else APPEAL_OVERTURNED,
            0,
            revision,
        )
        return {
            "facility_id": facility_id,
            "covenant_index": int(covenant_index),
            "appeal_status": APPEAL_UPHELD if upheld else APPEAL_OVERTURNED,
            "bond_atto": str(bond),
            "bond_paid_to": recipient.as_hex,
            "status": str(outcome["status"]),
        }

    # ----------------------------------------------------------------- reads

    @gl.public.view
    def get_finding(self, facility_id: str, covenant_index: int) -> dict:
        key = finding_key(facility_id, covenant_index)
        require(key in self.findings, "this covenant has not been tested yet")
        return self._finding_dict(self.findings[key])

    @gl.public.view
    def get_findings(self) -> list:
        return [
            self._finding_dict(self.findings[self.finding_keys[i]])
            for i in range(len(self.finding_keys))
        ]

    @gl.public.view
    def get_appeal_bond(self, facility_id: str, covenant_index: int) -> str:
        key = finding_key(facility_id, covenant_index)
        return str(int(self.appeal_bonds.get(key, u256(0))))

    # ------------------------------------------------------------ measuring

    def _measure_treasury(self, params: dict) -> dict:
        rpc_url = str(params["treasury_rpc_url"]).strip()
        account = str(params["treasury_address"]).strip()
        require(len(rpc_url) > 0 and len(account) > 0, "no treasury configured")
        require(rpc_url in TREASURY_PROVIDERS,
                "treasury RPC must be an approved Ethereum mainnet provider")
        require(len(account) == 42 and account.startswith("0x") and
                all(c in "0123456789abcdefABCDEF" for c in account[2:]),
                "invalid treasury address format")

        threshold_atto = int(params["threshold_atto"])
        comparator = str(params["comparator"])
        evidence = read_authenticated_balance(account, block_now())
        balance = int(evidence["balance"])
        breached = breaches(balance, threshold_atto, comparator)
        return {
            "breached": breached,
            "observed_bp": 0,
            "observed_atto": balance,
            "numerator_milli": 0,
            "denominator_milli": 0,
            "citation": normalise_citation(f"{TREASURY_PROVIDERS[0]}|{TREASURY_PROVIDERS[1]}|chain:1|{evidence['number']}|{evidence['hash']}"),
            "locator": f"eth_getBalance({account}, {evidence['number']})",
            "as_of": evidence["as_of"],
            "narrative": (
                f"Treasury {account} holds {balance} against a floor of {threshold_atto}."
            ),
        }

    def _measure_ratio(self, urls, numerator_label, denominator_label, covenant_text,
                       threshold_bp, comparator) -> dict:
        def leader():
            return extract_ratio_figures(
                urls, numerator_label, denominator_label, covenant_text
            )

        def validator(leaders_res) -> bool:
            return ratio_validator(
                leaders_res,
                urls,
                numerator_label,
                denominator_label,
                covenant_text,
                threshold_bp,
                comparator,
            )

        figures = gl.vm.run_nondet_unsafe(leader, validator)

        numerator_milli = int(figures["numerator_milli"])
        denominator_milli = int(figures["denominator_milli"])

        # The arithmetic runs in a sandbox in deterministic context, so the
        # numeric half of the test is exact and reproducible by every validator.
        def compute() -> int:
            return ratio_bp(numerator_milli, denominator_milli)

        observed_bp = int(gl.vm.unpack_result(gl.vm.spawn_sandbox(compute)))
        breached = breaches(observed_bp, threshold_bp, comparator)

        unit = str(figures.get("unit", "")).strip()
        unit_note = f" {unit}" if len(unit) > 0 else ""
        return {
            "breached": breached,
            "observed_bp": observed_bp,
            "observed_atto": 0,
            "numerator_milli": numerator_milli,
            "denominator_milli": denominator_milli,
            "citation": str(figures["citation"]),
            "locator": str(figures.get("locator", "")),
            "as_of": str(figures.get("as_of", "")),
            "narrative": (
                f"Read {format_scaled(numerator_milli, MILLI, 2)}{unit_note} against "
                f"{format_scaled(denominator_milli, MILLI, 2)}{unit_note}, a ratio of "
                f"{format_scaled(observed_bp, BP_ONE, 4)}x versus a "
                f"{format_scaled(threshold_bp, BP_ONE, 4)}x test."
            ),
        }

    def _measure_filing(self, urls, covenant_text, deadline_days, now) -> dict:
        def leader():
            return extract_filing_dates(urls, covenant_text, deadline_days)

        def validator(leaders_res) -> bool:
            return filing_validator(leaders_res, urls, covenant_text, deadline_days)

        dates = gl.vm.run_nondet_unsafe(leader, validator)

        period_end = str(dates["period_end"])
        published_at = str(dates.get("published_at", "")).strip()

        if len(published_at) == 0:
            elapsed = days_between(period_end, now)
            breached = elapsed > deadline_days
            narrative = (
                f"No report published for the period ended {period_end[:10]}. "
                f"{elapsed} days have passed against a {deadline_days} day deadline."
            )
        else:
            elapsed = days_between(period_end, published_at)
            breached = elapsed > deadline_days
            narrative = (
                f"Report for the period ended {period_end[:10]} was published "
                f"{published_at[:10]}, {elapsed} days later against a "
                f"{deadline_days} day deadline."
            )

        return {
            "breached": breached,
            "observed_bp": max(0, elapsed),
            "observed_atto": 0,
            "numerator_milli": 0,
            "denominator_milli": 0,
            "citation": str(dates["citation"]),
            "locator": str(dates.get("report_title", "")),
            "as_of": published_at or period_end,
            "narrative": narrative,
        }

    def _measure_prose(self, urls, covenant_text) -> dict:
        def leader():
            return extract_prose_finding(urls, covenant_text)

        def validator(leaders_res) -> bool:
            return prose_validator(leaders_res, urls, covenant_text)

        finding = gl.vm.run_nondet_unsafe(leader, validator)

        holds = bool(finding["holds"])
        artifact_id = str(finding["artifact_id"])
        title = str(finding.get("artifact_title", "")).strip()
        return {
            "breached": not holds,
            "observed_bp": BP_ONE if holds else 0,
            "observed_atto": 0,
            "numerator_milli": 0,
            "denominator_milli": 0,
            "citation": str(finding["citation"]),
            "locator": artifact_id,
            "as_of": str(finding.get("artifact_date", "")),
            "narrative": (
                ("The promise still holds. " if holds else "The promise has been broken. ")
                + (f"Relied on {title or artifact_id}. ")
                + str(finding.get("reasoning", ""))
            )[:900],
        }

    # ------------------------------------------------------------- plumbing

    def _read_parameters(self, facility_id: str, covenant_index: int) -> dict:
        key = finding_key(facility_id, covenant_index)
        require(key in self.agreed_covenants, "covenant is not authorized by borrower; finalized consent delivery pending")
        return json.loads(self.agreed_covenants[key])

    def _read_facility(self, facility_id: str) -> dict:
        key = facility_id.strip()
        require(key in self.agreed_facilities, "finalized agreement delivery is pending")
        return json.loads(self.agreed_facilities[key])

    def _persist(self, facility_id, covenant_index, kind, now, reading, status,
                 threshold_bp, consequence) -> None:
        key = finding_key(facility_id, covenant_index)
        if key not in self.finding_seen:
            self.finding_seen[key] = True
            self.finding_keys.append(key)

        self.test_total = u256(int(self.test_total) + 1)
        if bool(reading["breached"]):
            self.breach_total = u256(int(self.breach_total) + 1)

        self.findings[key] = Finding(
            facility_id=facility_id,
            covenant_index=u256(int(covenant_index)),
            kind=kind,
            tested_at=now,
            breached=bool(reading["breached"]),
            status=status,
            observed_bp=u256(max(0, int(reading["observed_bp"]))),
            observed_atto=u256(max(0, int(reading["observed_atto"]))),
            numerator_milli=u256(max(0, int(reading["numerator_milli"]))),
            denominator_milli=u256(max(0, int(reading["denominator_milli"]))),
            threshold_bp=u256(int(threshold_bp)),
            citation=str(reading["citation"])[:400],
            locator=str(reading["locator"])[:200],
            as_of=str(reading["as_of"])[:40],
            narrative=str(reading["narrative"])[:900],
            consequence_applied=consequence,
            sequence=u256(int(self.test_total)),
        )

    def _settle(self, facility_id, covenant_index, status, reading, consequence) -> None:
        key = finding_key(facility_id, covenant_index)
        finding = self.findings[key]
        revision = int(finding.sequence)
        self.facility_revisions[facility_id] = u256(revision)
        gl.get_contract_at(self.registry).emit(on="finalized").record_test_result(
            facility_id, int(covenant_index), status,
            int(finding.observed_bp), int(finding.observed_atto), finding.citation,
            revision, finding.tested_at, self.cure_deadlines.get(key, ""),
        )
        if self.vault != ZERO_ADDRESS:
            state = self.get_enforcement_state(facility_id)
            gl.get_contract_at(self.vault).emit(on="finalized").apply_enforcement(
                facility_id, revision, state["restrictions"]
            )

    @gl.public.write
    def sync_enforcement(self, facility_id: str) -> None:
        """Permissionless retry for failed/lost child messages; never moves bonds."""
        key = facility_id.strip()
        self._read_facility(key)
        state = self.get_enforcement_state(key)
        for i in range(len(self.finding_keys)):
            fkey = self.finding_keys[i]
            finding = self.findings[fkey]
            if finding.facility_id != key:
                continue
            gl.get_contract_at(self.registry).emit(on="finalized").record_test_result(
                key, int(finding.covenant_index), finding.status,
                int(finding.observed_bp), int(finding.observed_atto), finding.citation,
                int(finding.sequence), finding.tested_at, self.cure_deadlines.get(fkey, ""),
            )
            if fkey in self.appeal_outcomes:
                gl.get_contract_at(self.registry).emit(on="finalized").record_appeal(
                    key, int(finding.covenant_index), self.appeal_outcomes[fkey],
                    int(self.appeal_bonds.get(fkey, u256(0))),
                    int(self.appeal_revisions[fkey]),
                )
        if self.vault != ZERO_ADDRESS and state["revision"] > 0:
            gl.get_contract_at(self.vault).emit(on="finalized").apply_enforcement(
                key, state["revision"], state["restrictions"]
            )

    @gl.public.view
    def get_enforcement_state(self, facility_id: str) -> dict:
        """Complete snapshot; delivery does not depend on registry message order."""
        key = facility_id.strip()
        restrictions = []
        for i in range(len(self.finding_keys)):
            fkey = self.finding_keys[i]
            finding = self.findings[fkey]
            consequence = self.restrictions.get(fkey, "")
            if finding.facility_id == key and consequence:
                restrictions.append({"covenant_index": int(finding.covenant_index),
                                     "consequence": consequence})
        return {"facility_id": key,
                "revision": int(self.facility_revisions.get(key, u256(0))),
                "restrictions": restrictions}

    def _finding_dict(self, finding: Finding) -> dict:
        return {
            "facility_id": finding.facility_id,
            "covenant_index": int(finding.covenant_index),
            "kind": finding.kind,
            "tested_at": finding.tested_at,
            "breached": bool(finding.breached),
            "status": finding.status,
            "observed_bp": int(finding.observed_bp),
            "observed_atto": str(int(finding.observed_atto)),
            "numerator_milli": str(int(finding.numerator_milli)),
            "denominator_milli": str(int(finding.denominator_milli)),
            "threshold_bp": int(finding.threshold_bp),
            "citation": finding.citation,
            "locator": finding.locator,
            "as_of": finding.as_of,
            "narrative": finding.narrative,
            "consequence_applied": finding.consequence_applied,
            "sequence": int(finding.sequence),
        }


# ------------------------------------------------------- deterministic rules


def finding_key(facility_id: str, covenant_index: int) -> str:
    return f"{facility_id}#{int(covenant_index)}"


def derive_status(breached: bool, prior_status: str, cure_deadline: str,
                  cure_period_hours: int, now: str) -> str:
    """Move a covenant through its lifecycle.

    A clean test clears the covenant, and clears it as *cured* if it was inside
    a cure window. A failed test opens a cure window if the covenant has one,
    and hardens into a breach once that window has run out.
    """
    if not breached:
        if prior_status == COVENANT_PENDING_CURE:
            return COVENANT_CURED
        return COVENANT_COMPLIANT

    if cure_period_hours <= 0:
        return COVENANT_BREACHED
    if prior_status == COVENANT_BREACHED:
        return COVENANT_BREACHED
    if prior_status == COVENANT_PENDING_CURE:
        if len(cure_deadline) > 0 and now >= cure_deadline:
            return COVENANT_BREACHED
        return COVENANT_PENDING_CURE
    return COVENANT_PENDING_CURE


def consequence_for(status: str, configured: str) -> str:
    """Which consequence the vault should apply right now.

    A draw stop bites the moment a covenant trips, because a lender does not
    keep funding a borrower who is offside. A rate step-up or an acceleration
    waits for the cure window to lapse, because those are hard to undo.
    """
    if status == COVENANT_BREACHED:
        return configured
    if status == COVENANT_PENDING_CURE and configured == CONSEQUENCE_DRAW_STOP:
        return CONSEQUENCE_DRAW_STOP
    return ""


# Independent operators are protocol trust anchors, never caller-selected URLs.
# Treasury covenants currently support native ETH on Ethereum mainnet only.
TREASURY_PROVIDERS = ("https://ethereum-rpc.publicnode.com", "https://eth.drpc.org")


def rpc_result(url: str, method: str, params: list):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                          "params": params}).encode("utf-8")
    response = gl.nondet.web.post(url, body=payload,
                                  headers={"Content-Type": "application/json"})
    status = int(getattr(response, "status", 0) or 0)
    if status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} RPC returned {status}")
    if status != 200:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} RPC returned {status}")
    try:
        document = json.loads(response.body.decode("utf-8"))
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} malformed RPC JSON")
    if (not isinstance(document, dict) or document.get("jsonrpc") != "2.0" or
            type(document.get("id")) is not int or document["id"] != 1 or
            "error" in document or "result" not in document):
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} invalid RPC envelope")
    return document["result"]


def rpc_quantity(raw) -> int:
    if (not isinstance(raw, str) or not raw.startswith("0x") or len(raw) < 3 or
            (len(raw) > 3 and raw[2] == "0") or
            any(c not in "0123456789abcdef" for c in raw[2:])):
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} invalid RPC quantity")
    value = int(raw, 16)
    if value >= 2**256:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} RPC quantity out of bounds")
    return value


def authenticated_at(account: str, number: str, now: str) -> dict:
    results = []
    pinned_number = rpc_quantity(number)
    for url in TREASURY_PROVIDERS:
        if rpc_quantity(rpc_result(url, "eth_chainId", [])) != 1:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} treasury chain identity mismatch")
        finalized = rpc_result(url, "eth_getBlockByNumber", ["finalized", False])
        header = rpc_result(url, "eth_getBlockByNumber", [number, False])
        if not isinstance(header, dict) or not isinstance(finalized, dict):
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} invalid treasury block header")
        if rpc_quantity(finalized.get("number")) != pinned_number:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} treasury block is not the current finalized head")
        if rpc_quantity(header.get("number")) != pinned_number:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} treasury block number mismatch")
        block_hash = header.get("hash", "")
        if (not isinstance(block_hash, str) or len(block_hash) != 66 or
                not block_hash.startswith("0x") or
                any(c not in "0123456789abcdef" for c in block_hash[2:])):
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} invalid treasury block hash")
        if finalized.get("hash") != block_hash:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} finalized treasury block hash mismatch")
        timestamp = rpc_quantity(header.get("timestamp"))
        age = int(parse_iso(now).timestamp()) - timestamp
        if age < 0 or age > 86400:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} stale or future treasury block")
        # EIP-1898 anchors the balance to the independently matched block hash.
        balance = rpc_quantity(rpc_result(url, "eth_getBalance", [account,
            {"blockHash": block_hash, "requireCanonical": True}]))
        results.append({"number": number, "hash": block_hash, "balance": str(balance),
                        "as_of": format_iso(datetime.fromtimestamp(timestamp, timezone.utc))})
    if results[0] != results[1]:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} independent treasury providers disagree")
    return results[0]


def read_authenticated_balance(account: str, now: str) -> dict:
    def leader():
        header = rpc_result(TREASURY_PROVIDERS[0], "eth_getBlockByNumber", ["finalized", False])
        if not isinstance(header, dict):
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} invalid treasury block header")
        return authenticated_at(account, header.get("number"), now)

    def validator(result) -> bool:
        if not isinstance(result, gl.vm.Return):
            leader_msg = getattr(result, "message", "")
            try:
                leader()
                return False
            except Exception as err:
                return errors_agree(leader_msg, err)
        try:
            candidate = result.calldata
            return authenticated_at(account, candidate["number"], now) == candidate
        except Exception:
            return False

    return gl.vm.run_nondet_unsafe(leader, validator)
