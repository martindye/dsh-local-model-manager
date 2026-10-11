# Optional model-free CI

`github-actions-tests.yml` is a GitHub Actions template for Node.js 20 on Windows, Linux and macOS. It installs the locked dependencies and runs the CPU-only fixture tests; no model weights, serving binaries or GPU resources are required. Native Windows PowerShell tests are skipped on other operating systems.

To enable it, copy this file into `.github/workflows/test.yml` and push using credentials authorized to write workflows. The credentials used to publish 0.2.0 lacked GitHub's `workflow` scope, so the template is distributed here and has not run for that release. No additional permissions are needed to install or use the plugin.

Passing these tests would validate the mock lifecycle on those runners, without establishing real model, terminal application or GPU compatibility. Local 0.2.0 validation passed 47 tests on Windows Node.js 24.19.0.
