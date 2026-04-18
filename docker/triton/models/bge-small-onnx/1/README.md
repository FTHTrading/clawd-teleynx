# bge-small-onnx Model Artifact

`model.onnx` is intentionally excluded from Git history because GitHub blocks files over 100 MB.

Place the runtime model file here before starting Triton:

- Expected path: `docker/triton/models/bge-small-onnx/1/model.onnx`
- File is required at runtime for the embedding service.

If you need binary versioning, use Git LFS or an artifact bucket and pull the model during deploy.
