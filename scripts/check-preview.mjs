const baseUrl = (process.env.PREVIEW_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

const [home, health] = await Promise.all([
  fetch(`${baseUrl}/`),
  fetch(`${baseUrl}/health`),
]);
const healthBody = await health.json();

if (!home.ok || !(await home.text()).includes("Preview is healthy.")) {
  throw new Error(`Home check failed (${home.status})`);
}
if (!health.ok || healthBody.ok !== true || healthBody.service !== "our-website-preview") {
  throw new Error(`Health check failed (${health.status})`);
}

console.log(`Preview OK: ${baseUrl}`);
