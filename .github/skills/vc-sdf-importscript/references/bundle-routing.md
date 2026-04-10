# Bundle Routing & Script Types Reference

## Bundle Origins

### Bundle 317849 (VAR Connect Debug)

**Indicator:** `<scriptfile>[/SuiteBundles/Bundle 317849/...]</scriptfile>`

**Local Destination:** `src/FileCabinet/SuiteScripts/debug-vc/`

**Characteristics:**
- Debug/development versions of VAR Connect scripts
- Cannot be imported via `suitecloud file:import` — **always source from local workspace**
- Local source order: `itds-dev/` → `itds/current/`
- Maintain original subfolder structure (e.g. `Bill Creator/`, `Services/lib/`)

**Example Scripts:**
- `CTC_VC_MR_OrderStatus_debugger.js`
- `CTC_VC_BillCreate_Service_debugger.js`

---

### Non-Bundle 317849 (Custom / Non-VC Scripts)

**Indicator:** `<scriptfile>[/SuiteScripts/...]</scriptfile>`

**Local Destination:** `src/FileCabinet/SuiteScripts/debug-nonvc/`

**Characteristics:**
- Import directly via `suitecloud file:import`
- Paths with spaces require quoting; fall back to local copy if `INVALID FILE PATH`
- Dependencies may be unavailable if in restricted bundles

---

## Script Types

| Type               | Use Case                                        |
| ------------------ | ----------------------------------------------- |
| `SCHEDULEDSCRIPT`  | Scheduled jobs, polling, batch processing       |
| `MAPREDUCESCRIPT`  | Large-scale data processing                     |
| `SUITELET`         | Custom pages, form handlers                     |
| `USEREVENT`        | Record validation, automation on create/edit    |
| `CLIENTSCRIPT`     | Browser-side validation, dynamic UI             |
| `RESTLET`          | REST API endpoints                              |

> **Note:** Script type codes in the NetSuite XML do not always match what the ID name implies (e.g. `_rl_` in an ID may actually be `SCHEDULEDSCRIPT`). Always trust the explicitly provided type; verify against the XML `<scheduledscript>` / `<restlet>` root element if uncertain.

---

## Dependency Discovery

### Pattern Recognition

```javascript
var ns_record = require('N/record');                          // ❌ Skip (NetSuite)
var vc2_util = require('./CTC_VC2_Lib_Utils.js');            // ✅ Capture
var vclib_utils = require('./Services/lib/ctc_lib_utils.js');// ✅ Capture
var vcs_configLib = require('./Services/ctc_svclib_configlib.js'); // ✅ Capture
require('@babel/polyfill');                                   // ❌ Skip (external)
```

### Extraction Steps

1. Scan for `require()` calls — regex: `` require\s*\(\s*['"`]([^'"`]+)['"`]\s*\) ``
2. Skip `N/*` and non-relative paths without `./` or `../`
3. Resolve relative paths to absolute `/SuiteScripts/debug-vc/<path>`
4. Deduplicate; ensure `.js` extension on all paths

### Path Resolution Rules

| Path Style                     | Resolution                                    |
| ------------------------------ | --------------------------------------------- |
| `N/record`                     | Skip (NetSuite module)                        |
| `./CTC_VC2_Constants.js`       | `{basePath}/CTC_VC2_Constants.js`             |
| `./Services/lib/ctc_lib_utils` | `{basePath}/Services/lib/ctc_lib_utils.js`    |
| `../CTC_VC2_Constants`         | Resolve relative from script dir              |

---

## Dependency Import Strategy (Bundle 317849)

For each dependency discovered:

1. **Check** — Is it already in `debug-vc/`? → Skip
2. **Try import** — `suitecloud file:import --paths "/SuiteScripts/vcdebugger/<dep>"`
3. **Fallback** — Copy from `itds-dev/` or `itds/current/`

---

## Full Import Command Reference

```bash
# Extract dependencies
node .github/skills/vc-sdf-importscript/scripts/extract-dependencies.js \
  "src/FileCabinet/SuiteScripts/debug-vc/CTC_VC_MR_OrderStatus_debugger.js" \
  --base-path /SuiteScripts/debug-vc

# Import VC lib from vcdebugger if available
suitecloud file:import --paths \
  /SuiteScripts/vcdebugger/CTC_VC2_Constants.js \
  /SuiteScripts/vcdebugger/Services/lib/ctc_lib_utils.js \
  /SuiteScripts/vcdebugger/Services/ctc_svclib_configlib.js
```
