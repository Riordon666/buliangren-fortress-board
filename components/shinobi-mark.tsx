/** Village insignia shared by the public and squad interfaces. */
export function ShinobiMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <path d="M34 13c-6-7-19-5-23 4-5 11 3 22 14 22 9 0 16-7 16-15 0-6-4-10-9-10-6 0-10 4-10 9 0 4 3 7 6 7 4 0 6-3 5-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 17 9 6l14 5M14 35 6 42h17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
