import express from "express";

const PORT = 3000

const app = express();

app.get("/success", (req: any, res: any) => {
  res.send("Logged in");
})

app.get("/failed", (req: any, res: any) => {
  res.send("Failed to log in");
})

app.get("/content", (req: any, res: any) => {
  res.send("Content")
})

app.get("/*", (req: any, res: any) => {
  res.sendFile("index.html", { root: "." })
});

const server = app.listen(PORT, () => {
  console.log(`server started at http://localhost:${PORT}`);
});
