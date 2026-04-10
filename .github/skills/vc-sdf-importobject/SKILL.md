---
name: vc-sdf-importobject
description: 'Import a NetSuite custom object into the SDF project using an explicit object type and id, and store it under the matching Objects/{type}/ folder.'
argument-hint: 'id=<scriptid> type=<OBJECTTYPE>'
---

# vc-sdf-importobject

## Purpose

Import a NetSuite custom object into the SDF project using the exact object type provided by the user, and store the imported XML in the matching object-type folder.

---

## Inputs

| Parameter | Required | Description |
| --------- | -------- | ----------- |
| `id`      | ✅        | NetSuite object script ID or internal object ID to import |
| `type`    | ✅        | SDF object type to import; trust this value first |

**Examples:**
- `id=customscript_ctc_vcdeb_proc_orderstatus type=SCHEDULEDSCRIPT`
- `id=customsearch_ctc_vc_dh_itemrequest_2 type=SAVEDSEARCH`
- `id=customrecord_my_config type=CUSTOMRECORDTYPE`

---

## Destination Rule

Always import to:

```bash
src/Objects/<type>/
```

Examples:
- `type=SCHEDULEDSCRIPT` → `src/Objects/SCHEDULEDSCRIPT/`
- `type=SAVEDSEARCH` → `src/Objects/SAVEDSEARCH/`
- `type=CUSTOMRECORDTYPE` → `src/Objects/CUSTOMRECORDTYPE/`

Do not store imported objects directly under `src/Objects/` unless explicitly requested.

---

## Workflow

### Step 1 — Trust the Provided Type

Do not probe for alternate object types.

Use the exact type supplied by the user:

```bash
suitecloud object:import --scriptid <id> --type <TYPE> --destinationfolder /Objects/<TYPE>
```

If the import returns `Record does not exist` or `Invalid Record Type`, stop and ask the user to confirm the type.

---

### Step 2 — Ensure Folder Exists

Create the destination folder before import if needed:

```bash
mkdir -p src/Objects/<TYPE>
```

---

### Step 3 — Import the Object

Run:

```bash
suitecloud object:import \
  --scriptid <id> \
  --type <TYPE> \
  --destinationfolder /Objects/<TYPE>
```

Expected result:
- Object XML is stored under `src/Objects/<TYPE>/`
- File name usually matches the imported object ID, for example `customscript_foo.xml`

---

### Step 4 — Validate the Imported Output

Confirm:
- the destination folder exists
- the object XML exists inside `src/Objects/<TYPE>/`
- the imported XML matches the requested object ID

```bash
ls src/Objects/<TYPE>/
```

---

## Full Example

```bash
# Input
id=customscript_ctc_vcdeb_proc_orderstatus
 type=SCHEDULEDSCRIPT

# Create destination folder
mkdir -p src/Objects/SCHEDULEDSCRIPT

# Import object
suitecloud object:import \
  --scriptid customscript_ctc_vcdeb_proc_orderstatus \
  --type SCHEDULEDSCRIPT \
  --destinationfolder /Objects/SCHEDULEDSCRIPT
```

Result:

```bash
src/Objects/SCHEDULEDSCRIPT/customscript_ctc_vcdeb_proc_orderstatus.xml
```

---

## Troubleshooting

| Issue | Solution |
| ----- | -------- |
| `Record does not exist` | The provided `type` is likely wrong; ask the user to confirm it |
| `Invalid Record Type` | The provided `type` is not supported by SDF or mismatched for the object |
| File imported to wrong folder | Re-run with `--destinationfolder /Objects/<TYPE>` |
| Import created file refs/warnings | That is object-specific; this skill only imports the object into the correct folder |

---

## Key Principles

- Trust the provided `type`
- Accept exactly two primary inputs: `id` and `type`
- Store every imported object in `src/Objects/<TYPE>/`
- Keep the workflow narrow; this skill does not resolve script-file dependencies

---

**Related:** [vc-sdf-importscript](../vc-sdf-importscript/SKILL.md)
