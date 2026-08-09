import type { CSSProperties } from "react";

type AvatarProps = {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
};

const avatarColors = ["#df6f2d", "#4f805f", "#b98a3b", "#7b5f91", "#3f7187", "#9a5545"];

function colorForName(name: string) {
  const total = Array.from(name).reduce((sum, char) => sum + (char.codePointAt(0) || 0), 0);
  return avatarColors[total % avatarColors.length];
}

export function Avatar({ name, src, size = 42, className = "" }: AvatarProps) {
  const style = {
    "--avatar-size": `${size}px`,
    "--avatar-color": colorForName(name)
  } as CSSProperties;
  const initial = Array.from(name.replace(/^\./, ""))[0]?.toUpperCase() || "忍";

  return (
    <span className={`avatar ${className}`} style={style} aria-label={`${name}的头像`}>
      {src ? <img src={src} alt="" /> : <span>{initial}</span>}
    </span>
  );
}

