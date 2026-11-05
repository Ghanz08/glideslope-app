"use client";
import { useState } from "react";
import { formatMoneyInput } from "@/lib/core/money";
import { cx, inputClass } from "./ui";

/**
 * Rupiah field that formats while typing ("100000000" → "Rp 100.000.000"). The submitted value is the formatted
 * text; parse it with digitsToAmount (whole rupiah) or by dropping dots and turning the comma into a point (decimals).
 */
export function MoneyInput({
  id, name, defaultValue, decimals = false, error, placeholder, prefix = "Rp", onValue,
}: {
  id: string;
  name?: string;
  defaultValue?: number | null;
  decimals?: boolean;
  error?: string;
  placeholder?: string;
  prefix?: string | null;
  onValue?: (formatted: string) => void;
}) {
  const [text, setText] = useState(defaultValue ? formatMoneyInput(String(defaultValue).replace(".", ","), decimals) : "");
  return (
    <div className="relative">
      {prefix && <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[15px] font-semibold text-teks-pelan">{prefix}</span>}
      <input
        id={id}
        name={name}
        inputMode={decimals ? "decimal" : "numeric"}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-describedby={error ? `${id}-galat` : undefined}
        onChange={(e) => {
          const v = formatMoneyInput(e.target.value, decimals);
          setText(v);
          onValue?.(v);
        }}
        className={cx(inputClass(error), "tabular", prefix && "pl-10")}
      />
    </div>
  );
}
