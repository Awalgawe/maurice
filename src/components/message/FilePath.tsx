/** Renders a path with the directory muted and the filename accented. */
export function FilePath({ path }: { path: string }) {
  const parts = path.split("/");
  const name = parts.pop()!;
  const dir = parts.join("/");
  return (
    <span className="file-path">
      {dir && <span className="muted">{dir}/</span>}
      <span className="file-name">{name}</span>
    </span>
  );
}
