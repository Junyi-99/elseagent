// SQL files are imported as text (`with { type: "text" }`) to embed migrations.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
