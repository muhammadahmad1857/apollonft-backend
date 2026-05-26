import { app } from "./app";
import { prisma } from "./lib/prisma";
import { env } from "./config/env";


const server = app.listen(env.PORT, () => { 
  console.log(env.FRONTEND_ORIGINS)
  console.log(`Backend running on port ${env.PORT}`);
});



const shutdown = async (): Promise<void> => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
 app.use((req, res, next) => {
   console.log(req.method, req.path, req.headers.origin);
   next();
 });