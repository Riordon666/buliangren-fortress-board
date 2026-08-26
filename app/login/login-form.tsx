"use client";

import { useActionState } from "react";
import { KeyRound, LoaderCircle, UserRound } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <label>
        <span>组织账号</span>
        <span className="input-with-icon">
          <UserRound size={18} />
          <input name="username" autoComplete="username" placeholder="输入组员或游客账号" required />
        </span>
      </label>
      <label>
        <span>通行口令</span>
        <span className="input-with-icon">
          <KeyRound size={18} />
          <input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required />
        </span>
      </label>
      {state.error && <div className="form-message error" role="alert">{state.error}</div>}
      <button type="submit" className="primary-button login-button" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" size={18} /> 正在验证</> : "登录并进入内部"}
      </button>
    </form>
  );
}
