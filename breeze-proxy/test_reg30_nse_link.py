#!/usr/bin/env python3
"""
Test Reg30 pipeline for a single NSE iXBRL link.
Run with the breeze proxy server up: python test_reg30_nse_link.py
Uses: /api/attachment/parse then /api/gemini/reg30-analyze
"""
import os
import json
import requests

PROXY_BASE = os.environ.get("PROXY_URL", "http://127.0.0.1:8082")
NSE_LINK = "https://nsearchives.nseindia.com/corporate/ixbrl/ANN_AWARD_BAGGING_144841_05032026193733_iXBRL_WEB.html"


def main():
    print("1. Fetching document text from NSE link via proxy...")
    r = requests.post(
        f"{PROXY_BASE}/api/attachment/parse",
        json={"url": NSE_LINK},
        headers={"Content-Type": "application/json"},
        timeout=45,
    )
    if not r.ok:
        print(f"   FAIL: parse returned {r.status_code}", r.text[:500])
        return
    data = r.json()
    text = data.get("text") or ""
    print(f"   OK: got {len(text)} chars")
    if len(text) < 100:
        print("   WARNING: text too short; NSE may have blocked or page is empty.")
        return
    if "NSE Symbol" in text and "MCLOUD" in text:
        print("   OK: document contains NSE Symbol and MCLOUD")
    if "Magellanic" in text:
        print("   OK: document contains company name")
    if "49921345" in text or "4.99" in text or "Broad commercial" in text:
        print("   OK: document contains order size / broad commercial consideration")

    print("\n2. Running Reg30 Gemini analysis...")
    candidate = {
        "company_name": "Unknown",
        "symbol": "",
        "source": "XBRL",
        "raw_text": "",
    }
    r2 = requests.post(
        f"{PROXY_BASE}/api/gemini/reg30-analyze",
        json={"candidate": candidate, "attachment_text": text[:30000]},
        headers={"Content-Type": "application/json"},
        timeout=120,
    )
    if not r2.ok:
        print(f"   FAIL: reg30-analyze returned {r2.status_code}", r2.text[:800])
        return
    out = r2.json()
    if "error" in out:
        print("   FAIL:", out["error"])
        return

    summary = out.get("summary") or ""
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
    print("summary (first 300 chars):", summary[:300])
    print("\nFull extracted keys:", list(extracted.keys()))

    if symbol == "MCLOUD" or extracted.get("nse_symbol") == "MCLOUD":
        print("\n[PASS] Symbol MCLOUD extracted correctly.")
    else:
        print("\n[FAIL] Expected symbol MCLOUD; got", repr(symbol), "/", repr(extracted.get("nse_symbol")))
    if "Magellanic" in (company_name or "") or "Magellanic" in str(extracted.get("company_name") or ""):
        print("[PASS] Company name contains Magellanic.")
    else:
        print("[FAIL] Expected company name to contain Magellanic; got", repr(company_name), "/", repr(extracted.get("company_name")))
    if order_cr is not None and 4 <= order_cr <= 6:
        print("[PASS] Order value in Crore ~4.99 (expected range 4-6).")
    else:
        print("[INFO] Order value (Cr):", order_cr, "(expected ~4.99)")


if __name__ == "__main__":
    main()
