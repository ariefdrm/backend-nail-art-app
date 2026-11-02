export async function index() {
  return {
    success: true,
    status: 200,
    message: "Hello World! Express.js + TypeScript + Bun",
    runtime: "Bun",
    framework: "Express.js",
  };
}
