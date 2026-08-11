import { createApp } from "./app";
import { env } from "./config/env";
import { startReportScheduler } from "./lib/reportScheduler";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Athar backend يعمل على المنفذ ${env.port} (${env.nodeEnv})`);
});

startReportScheduler();
