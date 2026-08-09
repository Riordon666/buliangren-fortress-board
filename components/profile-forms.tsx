"use client";

import { useActionState, useEffect, useState } from "react";
import { Camera, CheckCircle2, Eye, EyeOff, ImageUp, KeyRound, LoaderCircle } from "lucide-react";
import { changePasswordAction, updateAvatarAction, type FormState } from "@/app/profile/actions";
import { Avatar } from "@/components/avatar";

const initialState: FormState = {};

export function AvatarForm({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [state, action, pending] = useActionState(updateAvatarAction, initialState);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <form action={action} className="profile-form avatar-form">
      <div className="avatar-editor">
        {preview ? <span className="avatar preview-avatar"><img src={preview} alt="头像预览" /></span> : <Avatar name={name} src={avatarUrl} size={116} />}
        <span className="camera-badge"><Camera size={17} /></span>
      </div>
      <div className="upload-copy">
        <h3>更换忍者头像</h3>
        <p>支持 JPG、PNG、WebP，最大 2MB；系统会自动裁成方形。</p>
        <label className="file-button">
          <ImageUp size={17} /> 选择图片
          <input
            type="file"
            name="avatar"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (preview) URL.revokeObjectURL(preview);
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            required
          />
        </label>
        {state.error && <div className="form-message error">{state.error}</div>}
        {state.success && <div className="form-message success"><CheckCircle2 size={15} />{state.success}</div>}
      </div>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" size={17} /> 处理中</> : "保存新头像"}
      </button>
    </form>
  );
}

export function PasswordForm({ required }: { required: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state.success) {
      const timer = window.setTimeout(() => window.location.assign("/login?changed=1"), 1400);
      return () => window.clearTimeout(timer);
    }
  }, [state.success]);

  return (
    <form action={action} className="profile-form password-form">
      <div className="form-title">
        <span className="section-icon"><KeyRound size={19} /></span>
        <div><h3>{required ? "首次登录，请设置新密码" : "修改通行口令"}</h3><p>新密码至少 8 位，修改后需要重新登录。</p></div>
      </div>
      <div className="form-grid">
        <label className="full-span">
          <span>当前密码</span>
          <span className="password-control">
            <input name="currentPassword" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="显示或隐藏密码">
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        <label><span>新密码</span><input name="newPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required /></label>
        <label><span>确认新密码</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required /></label>
      </div>
      {state.error && <div className="form-message error">{state.error}</div>}
      {state.success && <div className="form-message success"><CheckCircle2 size={15} />{state.success}</div>}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" size={17} /> 正在加密</> : "更新密码"}
      </button>
    </form>
  );
}

