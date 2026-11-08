// Keeps the harness runnable before real suites exist.
export default (bench) => bench("dummy", () => { let s = 0; for (let i = 0; i < 1000; i++) s += i; return s; }, 50);
