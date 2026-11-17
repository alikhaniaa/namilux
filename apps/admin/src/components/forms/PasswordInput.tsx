"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/kit";

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <span dir={props.dir ?? "ltr"} className="relative block">
      <Input {...props} id={id} type={visible ? "text" : "password"} className={`pe-12! ${props.className ?? ""}`} />
      <button type="button" className="absolute inset-y-0 end-0 flex w-11 items-center justify-center"
        aria-label={visible ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} aria-controls={id} aria-pressed={visible}
        disabled={props.disabled} onClick={() => setVisible((value) => !value)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </span>
  );
}
