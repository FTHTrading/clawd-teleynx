# Riva Model Repository

The NVIDIA Riva speech server image in this stack does not contain an ASR/TTS model repository.

It requires a mounted Triton model repo at:

- `docker/riva/models`

Current state:

- `inference-router` is up
- `speech-router` is up
- `clawdbot-v2` is up
- `nvidia-triton` is up
- `nvidia-riva-speech` cannot become healthy until this directory contains a valid Riva model repository

Expected next step:

1. Bootstrap or download NVIDIA Riva ASR/TTS models into `docker/riva/models`
2. Start the speech profile:

```powershell
docker compose -f docker/compose.nvidia-stack.yml --env-file docker/riva/.env.example --profile speech up -d riva-speech
```

Once the repo exists, the speech router will begin using NVIDIA Riva instead of the local Whisper/Piper fallback.
