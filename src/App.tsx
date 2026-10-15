import { useState } from "react";
import "./App.css";

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  async function uploadFile() {
    if (!file) {
      setMessage("Please choose a file first.");
      return;
    }

    setMessage("Uploading...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Upload failed.");
        return;
      }

      setMessage(`Uploaded: ${data.file.name}`);
    } catch {
      setMessage("Upload failed.");
    }
  }

  return (
    <main>
      <h1>Cloud File Storage</h1>

      <p>Upload a file to Cloudflare R2.</p>

      <input
        type="file"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setMessage("");
        }}
      />

      <button onClick={uploadFile}>Upload</button>

      {message && <p>{message}</p>}
    </main>
  );
}

export default App;
