#!/usr/bin/env python3
"""
Test Reg30 pipeline for NSE iXBRL links.
Run with the breeze proxy server up: python test_reg30_nse_link.py [mcloud|niraj]
Uses: /api/attachment/parse then /api/gemini/reg30-analyze
"""
import os
import sys
import requests

PROXY_BASE = os.environ.get("PROXY_URL", "http://127.0.0.1:8082")

TESTS = {
    "mcloud": {
        "url": "https://nsearchives.nseindia.com/corporate/ixbrl/ANN_AWARD_BAGGING_144841_05032026193733_iXBRL_WEB.html",
        "expected_symbol": "MCLOUD",
        "expected_company_substr": "Magellanic",
        "expected_order_range": (4, 6),
    },
    "niraj": {
        "url": "https://nsearchives.nseindia.com/corporate/ixbrl/ANN_AWARD_BAGGING_144898_06032026181059_iXBRL_WEB.html",
        "expected_symbol": "NIRAJ",
        "expected_company_substr": "Niraj Cement",
        "expected_order_range": (400, 420),
    },
}


def run_test(name, cfg):
    print(f"\n=== [{name.upper()}] ===")
    print(f"1. Fetching document text from NSE link via proxy...")
    r = requests.post(
        f"{PROXY_BASE}/api/attachment/parse",
        json={"url": cfg["url"]},
        headers={"Content-Type": "application/json"},
        timeout=45,
    )
    if not r.ok:
        print(f"   FAIL: parse returned {r.status_code}", r.text[:500])
        return False
    data = r.json()
    text = data.get("text") or ""
    print(f"   OK: got {len(text)} chars")
    if len(text) < 100:
        print("   WARNING: text too short; NSE may have blocked or page is empty.")
        return False

    sym = cfg["expected_symbol"]
    co_sub = cfg["expected_company_substr"]
    if "NSE Symbol" in text and sym in text:
        print(f"   OK: document contains NSE Symbol and {sym}")
    else:
        print(f"   WARNING: '{sym}' or 'NSE Symbol' not found in parsed text (first 200 chars: {text[:200]!r})")
    if co_sub in text:
        print(f"   OK: document contains company name ({co_sub!r})")

    print("\n2. Running Reg30 Gemini analysis...")
    candidate = {"company_name": "Unknown", "symbol": "", "source": "XBRL", "raw_text": ""}
    r2 = requests.post(
        f"{PROXY_BASE}/api/gemini/reg30-analyze",
        json={"candidate": candidate, "attachment_text": text[:30000]},
        headers={"Content-Type": "application/json"},
        timeout=120,
    )
    if not r2.ok:
        print(f"   FAIL: reg30-analyze returned {r2.status_code}", r2.text[:800])
        return False
    out = r2.json()
    if "error" in out:
        print("   FAIL:", out["error"])
        return False

    symbol = out.get("symbol") or ""
    company_name = out.get("company_name") or ""
    extracted = out.get("extracted") or {}
    order_cr = extracted.get("order_value_cr")
    stage = extracted.get("stage")
    print("   OK: analysis completed\n")
    print("--- Result ---")
    print("symbol (top-level):", repr(symbol))
    print("company_name (top-level):", repr(company_name))
    print("extracted.nse_symbol:", repr(extracted.get("nse_symbol")))
    print("extracted.company_name:", repr(extracted.get("company_name")))
    print("extracted.order_value_cr:", order_cr)
    print("extracted.stage:", stage)
    print("summary (first 200 chars):", (out.get("summary") or "")[:200])

    passed = True
    if symbol == sym or extracted.get("nse_symbol") == sym:
        print(f"\n[PASS] Symbol {sym} extracted correctly.")
    else:
        print(f"\n[FAIL] Expected symbol {sym}; got {symbol!r} / {extracted.get('nse_symbol')!r}")
        passed = False
    if co_sub in (company_name or "") or co_sub in str(extracted.get("company_name") or ""):
        print(f"[PASS] Company name contains {co_sub!r}.")
    else:
        print(f"[FAIL] Expected company containing {co_sub!r}; got {company_name!r} / {extracted.get('company_name')!r}")
        passed = False
    lo, hi = cfg["expected_order_range"]
    if order_cr is not None and lo <= order_cr <= hi:
        print(f"[PASS] Order value in Crore {order_cr} (expected {lo}-{hi}).")
    else:
        print(f"[INFO] Order value (Cr): {order_cr} (expected range {lo}-{hi})")
    return passed


def main():
    arg = sys.argv[1].lower() if len(sys.argv) > 1 else None
    tests_to_run = {arg: TESTS[arg]} if arg and arg in TESTS else TESTS
    results = {}
    for name, cfg in tests_to_run.items():
        results[name] = run_test(name, cfg)
    print("\n=== Summary ===")
    for name, ok in results.items():
        print(f"  [{name}]: {'PASS' if ok else 'FAIL'}")


if __name__ == "__main__":
    main()
