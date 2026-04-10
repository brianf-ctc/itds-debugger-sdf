---
name: vc-sdf-importscript
description: 'Import a SuiteScript object from NetSuite into the SDF project with automatic dependency resolution. Accepts explicit script ID and type; routes files to debug-vc or debug-nonvc based on bundle origin.'
argument-hint: 'scriptid=<id> type=<SCRIPTTYPE>'
---

# vc-sdf-importscript

## Purpose

Import a NetSuite SuiteScript record (XML object + script files + dependencies) into the SDF project, with automatic routing based on bundle origin.

---

## Inputs

| Parameter  | Required | Description                                                       |
| ---------- | -------- | ----------------------------------------------------------------- |
| `scriptid` | ✅        | NetSuite script record ID (e.g. `customscript_ctc_vcdeb_rl_foo`) |
| `type`     | ✅        | Script type — **always trusted first, never probed**              |

**Supported types:** `SCHEDULEDSCRIPT` · `MAPREDUCESCRIPT` · `SUITELET` · `USEREVENT` · `CLIENTSCRIPT` · `RESTLET`

---

## Destination Folders

| Origin        | Local Destination                           |
| ------------- | ------------------------------------------- |
| Bundle 317849 | `src/FileCabinet/SuiteScripts/debug-vc/`    |
| All others    | `src/FileCabinet/SuiteScripts/debug-nonvc/` |

---

## Workflow

### Step 1 — Import Script Object XML

```bash
suitecloud object:import --scriptid <scriptid> --type <TYPE> --destinationfolder /Objects
```

- ✅ XML created at `src/Objects/<scriptid>.xml` even if script file fails to import.
- ❌ If `Record does not exist` — type is wrong. **Stop and ask the user to confirm the correct type. Do not probe other types.**

---

### Step 2 — Read `<scriptfile>` from XML

Check the `<scriptfile>` element to determine routing:

```xml
<!-- Bundle 317849 → debug-vc -->
<scriptfile>[/SuiteBundles/Bundle 317849/path/to/file.js]</scriptfile>

<!-- Non-bundle → debug-nonvc -->
<scriptfile>[/SuiteScripts/path/to/file.js]</scriptfile>
```

---

### Step 3 — Import Main Script File

#### If Bundle 317849 → `debug-vc/`

`suitecloud file:import` **cannot import bundle files**. Source from local workspace instead:

1. Resolve the relative path from the XML (strip `[/SuiteBundles/Bundle 317849/]` prefix)
2. Search for the file in this order:
   - `itds-dev/<relative-path>`
   - `itds/current/<relative-path>`
3. Copy to `src/FileCabinet/SuiteScripts/debug-vc/<relative-path>` (create dirs as needed)

```bash
mkdir -p "src/FileCabinet/SuiteScripts/debug-vc/<subfolder>"
cp "itds-dev/<relative-path>" "src/FileCabinet/SuiteScripts/debug-vc/<relative-path>"
```

#### If Non-Bundle 317849 → `debug-nonvc/`

Import directly:

```bash
suitecloud file:import --paths "/SuiteScripts/path/to/file.js"
```

> ⚠️ If the path contains spaces, it will fail with `INVALID FILE PATH`. Fall back to local workspace copy.

---

### Step 4 — Resolve Dependencies

Run the dependency extractor on the downloaded script file:

```bash
node .github/skills/vc-sdf-importscript/scripts/extract-dependencies.js \
  "src/FileCabinet/SuiteScripts/debug-vc/<relative-path>" \
  --base-path /SuiteScripts/debug-vc
```

For each dependency path in the output:

1. **Skip** `N/*` (NetSuite platform modules)
2. **Check** if already present under `debug-vc/` — skip if exists
3. **Try** `suitecloud file:import --paths "/SuiteScripts/vcdebugger/<dep>"` for VC libs
4. **Fallback** — copy from `itds-dev/` or `itds/current/` if import fails

---

### Step 5 — Update XML `<scriptfile>` Path

Replace the bundle path with the local SuiteScripts path:

```xml
<!-- Before -->
<scriptfile>[/SuiteBundles/Bundle 317849/Bill Creator/CTC_VC_BillCreate_Service_debugger.js]</scriptfile>

<!-- After -->
<scriptfile>[/SuiteScripts/debug-vc/Bill Creator/CTC_VC_BillCreate_Service_debugger.js]</scriptfile>
```

---

### Step 6 — Validate

```bash
ls -R src/FileCabinet/SuiteScripts/debug-vc/
# or
ls -R src/FileCabinet/SuiteScripts/debug-nonvc/
```

Confirm:
- ✅ Main script file present
- ✅ All dependencies present
- ✅ `<scriptfile>` path in XML matches actual location

---

### Step 7 — Deploy (if requested)

```bash
suitecloud project:deploy
```

---

## Full Example

```bash
# Input: scriptid=customscript_ctc_vcdeb_rl_billfile_svc  type=SCHEDULEDSCRIPT

# 1. Import XML object
suitecloud object:import \
  --scriptid customscript_ctc_vcdeb_rl_billfile_svc \
  --type SCHEDULEDSCRIPT \
  --destinationfolder /Objects

# 2. Read XML → scriptfile: /SuiteBundles/Bundle 317849/Bill Creator/CTC_VC_BillCreate_Service_debugger.js
#    → Bundle 317849 → debug-vc

# 3. Source from local and copy
mkdir -p "src/FileCabinet/SuiteScripts/debug-vc/Bill Creator"
cp "itds-dev/Bill Creator/CTC_VC_BillCreate_Service_debugger.js" \
   "src/FileCabinet/SuiteScripts/debug-vc/Bill Creator/"

# 4. Extract dependencies
node .github/skills/vc-sdf-importscript/scripts/extract-dependencies.js \
  "src/FileCabinet/SuiteScripts/debug-vc/Bill Creator/CTC_VC_BillCreate_Service_debugger.js" \
  --base-path /SuiteScripts/debug-vc
# → /SuiteScripts/debug-vc/CTC_VC2_Constants.js
# → /SuiteScripts/debug-vc/CTC_VC2_Lib_Utils.js
# → /SuiteScripts/debug-vc/Bill Creator/Libraries/CTC_VC_Lib_Vendor_Map.js
# → /SuiteScripts/debug-vc/Bill Creator/Libraries/CTC_VC_Lib_Create_Bill_Files.js
# → /SuiteScripts/debug-vc/Services/lib/moment.js
# → /SuiteScripts/debug-vc/Services/ctc_svclib_configlib.js
# → /SuiteScripts/debug-vc/Services/ctc_svclib_records.js

# 5. Update XML scriptfile
# <scriptfile>[/SuiteScripts/debug-vc/Bill Creator/CTC_VC_BillCreate_Service_debugger.js]</scriptfile>
```

---

## Troubleshooting

| Issue                              | Solution                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `Record does not exist`            | Wrong type — ask user to confirm; do **not** probe other types                 |
| `INVALID FILE PATH` on file:import | Path contains spaces; copy from local workspace instead                        |
| Bundle file not importable         | Always expected for Bundle 317849; source from `itds-dev/` or `itds/current/` |
| Dependency missing at runtime      | Re-run extractor; check `require()` in transitive dependencies                 |
| XML `<scriptfile>` path mismatch   | Must exactly match the actual file location under `/SuiteScripts/`             |

---

## Key Principles

- **Trust the provided type** — never probe multiple types speculatively
- **Bundle 317849** = local workspace source → `debug-vc/`
- **Non-Bundle 317849** = direct import → `debug-nonvc/`
- **Check before copying** — skip dependencies already present in the target folder
- **Maintain subfolder structure** — preserve `Bill Creator/`, `Services/lib/`, etc.

---

**Related:** [VAR Connect SuiteScript Standards](../../copilot-instructions.md), [Bundle Routing Reference](references/bundle-routing.md)
