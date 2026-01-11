const el = (sel) => document.querySelector(sel);

const schemaFilesInput = el("#schemaFiles");
const schemaSelect = el("#schemaSelect");
const outName = el("#outName");
const schemaMeta = el("#schemaMeta");
const oneOfPicker = el("#oneOfPicker");
const formRoot = el("#formRoot");
const jsonPreview = el("#jsonPreview");
const errorsRoot = el("#errors");

const defaultsBtn = el("#defaultsBtn");
const clearBtn = el("#clearBtn");
const copyBtn = el("#copyBtn");
const downloadBtn = el("#downloadBtn");
const resetBtn = el("#loadExample");

const state = {
  schemas: new Map(), // name -> schemaObject
  activeSchemaName: null,
  activeOneOfIndex: 0,
  values: {}, // generated JSON in-progress
};

function deepGet(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function deepSet(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (typeof cur[p] !== "object" || cur[p] == null) cur[p] = {};
    cur = cur[p];
  }
  cur[path[path.length - 1]] = value;
}
function deepDelete(obj, path) {
  if (!path.length) return;
  const parent = deepGet(obj, path.slice(0, -1));
  if (parent && typeof parent === "object")
    delete parent[path[path.length - 1]];
}

function jsonPointerGet(root, pointer) {
  // pointer like "#/definitions/face"
  const p = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  const parts = p
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  return deepGet(root, parts);
}

function resolveSchema(schema, node) {
  if (!node || typeof node !== "object") return node;
  if (
    node.$ref &&
    typeof node.$ref === "string" &&
    node.$ref.startsWith("#/")
  ) {
    const target = jsonPointerGet(schema, node.$ref);
    if (!target) return node;
    // Merge: referenced schema + local overrides (local wins)
    const { $ref, ...rest } = node;
    return { ...target, ...rest };
  }
  return node;
}

function pickRootSchema(schema) {
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const idx = state.activeOneOfIndex ?? 0;
    return resolveSchema(
      schema,
      schema.oneOf[Math.max(0, Math.min(idx, schema.oneOf.length - 1))]
    );
  }
  return schema;
}

function schemaTitle(schema) {
  return schema.title || schema.$id || "(untitled schema)";
}

function guessOutputName(schemaName) {
  // model.schema.json -> model.json
  const n = schemaName.replace(/\.schema\.json$/i, ".json");
  return n === schemaName ? "output.json" : n;
}

function render() {
  const schemaName = state.activeSchemaName;
  if (!schemaName) {
    formRoot.textContent = "Load schemas to begin.";
    formRoot.classList.add("muted");
    jsonPreview.textContent = "{}";
    schemaMeta.textContent = "";
    return;
  }

  const schema = state.schemas.get(schemaName);
  const root = pickRootSchema(schema);

  schemaMeta.innerHTML = [
    schema.title
      ? `<div><strong>${escapeHtml(schema.title)}</strong></div>`
      : "",
    schema.description ? `<div>${escapeHtml(schema.description)}</div>` : "",
    schema.$id
      ? `<div class="hint">$id: <code>${escapeHtml(schema.$id)}</code></div>`
      : "",
    schema.$schema
      ? `<div class="hint">$schema: <code>${escapeHtml(
          schema.$schema
        )}</code></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  renderOneOf(schema);

  formRoot.classList.remove("muted");
  formRoot.innerHTML = "";
  const form = document.createElement("div");
  form.appendChild(
    renderNode(schema, root, [], { label: schemaTitle(schema), required: true })
  );
  formRoot.appendChild(form);

  updatePreviewAndValidate();
}

function renderOneOf(schema) {
  oneOfPicker.innerHTML = "";
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    oneOfPicker.style.display = "flex";

    const label = document.createElement("div");
    label.className = "field";
    label.innerHTML = `<span>Schema variant (oneOf)</span>`;
    const sel = document.createElement("select");

    schema.oneOf.forEach((opt, i) => {
      const resolved = resolveSchema(schema, opt);
      const o = document.createElement("option");
      const title =
        resolved.title ||
        (resolved.required?.includes("variants")
          ? "variants"
          : resolved.required?.includes("multipart")
          ? "multipart"
          : `option ${i + 1}`);
      o.value = String(i);
      o.textContent = `${i + 1}: ${title}`;
      if (i === state.activeOneOfIndex) o.selected = true;
      sel.appendChild(o);
    });

    sel.addEventListener("change", () => {
      state.activeOneOfIndex = Number(sel.value) || 0;
      state.values = {}; // reset values when switching variants
      render();
    });

    label.appendChild(sel);
    oneOfPicker.appendChild(label);
  } else {
    oneOfPicker.style.display = "none";
  }
}

function renderNode(schemaRoot, node0, path, ctx) {
  let node = resolveSchema(schemaRoot, node0);

  // Basic composition support
  if (Array.isArray(node.allOf) && node.allOf.length) {
    node = node.allOf
      .map((x) => resolveSchema(schemaRoot, x))
      .reduce((acc, cur) => mergeSchemas(acc, cur), {});
  }

  if (Array.isArray(node.oneOf) && node.oneOf.length) {
    return renderInlineOneOf(schemaRoot, node, path, ctx);
  }

  const type = inferType(node);

  if (type === "object") return renderObject(schemaRoot, node, path, ctx);
  if (type === "array") return renderArray(schemaRoot, node, path, ctx);
  if (type === "boolean") return renderBoolean(schemaRoot, node, path, ctx);
  if (type === "number" || type === "integer")
    return renderNumber(schemaRoot, node, path, ctx, type);
  return renderString(schemaRoot, node, path, ctx); // default to string-ish
}

function mergeSchemas(a, b) {
  // minimal merge for allOf use-cases
  const out = { ...a, ...b };
  if (a.properties || b.properties)
    out.properties = { ...(a.properties || {}), ...(b.properties || {}) };
  if (a.required || b.required)
    out.required = Array.from(
      new Set([...(a.required || []), ...(b.required || [])])
    );
  return out;
}

function inferType(node) {
  if (node.type) return Array.isArray(node.type) ? node.type[0] : node.type;
  if (node.properties || node.additionalProperties) return "object";
  if (node.items) return "array";
  if (node.enum) return typeof node.enum[0] === "number" ? "number" : "string";
  return "string";
}

function fieldWrap(labelText, required, innerEl, hintText) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const lab = document.createElement("span");
  lab.textContent = required ? `${labelText} *` : labelText;
  wrap.appendChild(lab);
  wrap.appendChild(innerEl);
  if (hintText) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = hintText;
    wrap.appendChild(hint);
  }
  return wrap;
}

function renderObject(schemaRoot, node, path, ctx) {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = ctx.label || "object";
  fs.appendChild(lg);

  const props = node.properties || {};
  const requiredSet = new Set(node.required || []);

  // If it's a "map"/dictionary object (additionalProperties), render key/value editor
  const isPureMap = !Object.keys(props).length && !!node.additionalProperties;

  if (isPureMap) {
    const ap = resolveSchema(schemaRoot, node.additionalProperties);
    const list = document.createElement("div");

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn smallBtn";
    addBtn.textContent = "Add entry";
    addBtn.addEventListener("click", () => {
      const key = prompt("Key?");
      if (!key) return;
      const cur = deepGet(state.values, path) ?? {};
      cur[key] = defaultFor(ap, schemaRoot);
      deepSet(state.values, path, cur);
      render();
    });

    fs.appendChild(addBtn);

    const curObj = deepGet(state.values, path) ?? {};
    Object.entries(curObj).forEach(([k, v]) => {
      const row = document.createElement("div");
      row.className = "kvRow";

      const keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.value = k;
      keyInput.addEventListener("change", () => {
        const obj = deepGet(state.values, path) ?? {};
        if (keyInput.value && keyInput.value !== k) {
          obj[keyInput.value] = obj[k];
          delete obj[k];
          deepSet(state.values, path, obj);
          render();
        }
      });

      const valNode = renderNode(schemaRoot, ap, [...path, k], {
        label: "Value",
        required: true,
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn smallBtn secondary";
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        const obj = deepGet(state.values, path) ?? {};
        delete obj[k];
        deepSet(state.values, path, obj);
        render();
      });

      row.appendChild(fieldWrap("Key", true, keyInput));
      row.appendChild(valNode);
      row.appendChild(del);
      list.appendChild(row);
    });

    fs.appendChild(list);
    return fs;
  }

  // Normal object properties
  for (const [prop, propSchema0] of Object.entries(props)) {
    const propSchema = resolveSchema(schemaRoot, propSchema0);
    const req = requiredSet.has(prop);
    const label = prop;
    const hint =
      propSchema.description || propSchema.pattern
        ? propSchema.description
        : "";
    const child = renderNode(schemaRoot, propSchema, [...path, prop], {
      label,
      required: req,
    });
    if (hint && child.querySelector && !child.querySelector(".hint")) {
      // Add hint if child is a simple label wrapper; otherwise it already has nested hints
    }
    fs.appendChild(child);

    // For optional props, allow quick "unset" button
    if (!req) {
      const row = document.createElement("div");
      row.className = "row";
      const unset = document.createElement("button");
      unset.type = "button";
      unset.className = "btn secondary smallBtn";
      unset.textContent = `Unset "${prop}"`;
      unset.addEventListener("click", () => {
        deepDelete(state.values, [...path, prop]);
        updatePreviewAndValidate();
      });
      row.appendChild(unset);
      fs.appendChild(row);
    }
  }

  return fs;
}

function renderArray(schemaRoot, node, path, ctx) {
  const fs = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = ctx.label || "array";
  fs.appendChild(lg);

  const itemsSchema = resolveSchema(schemaRoot, node.items || {});
  const cur = deepGet(state.values, path);
  const arr = Array.isArray(cur) ? cur : [];

  const list = document.createElement("div");

  arr.forEach((_, idx) => {
    const row = document.createElement("div");
    row.className = "kvRow";
    const idxBox = document.createElement("div");
    idxBox.className = "hint";
    idxBox.textContent = `#${idx}`;

    const itemField = renderNode(schemaRoot, itemsSchema, [...path, idx], {
      label: "Item",
      required: true,
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn smallBtn secondary";
    del.textContent = "Remove";
    del.addEventListener("click", () => {
      const curArr = Array.isArray(deepGet(state.values, path))
        ? deepGet(state.values, path)
        : [];
      curArr.splice(idx, 1);
      deepSet(state.values, path, curArr);
      render();
    });

    row.appendChild(idxBox);
    row.appendChild(itemField);
    row.appendChild(del);
    list.appendChild(row);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn smallBtn";
  add.textContent = "Add item";
  add.addEventListener("click", () => {
    const curArr = Array.isArray(deepGet(state.values, path))
      ? deepGet(state.values, path)
      : [];
    curArr.push(defaultFor(itemsSchema, schemaRoot));
    deepSet(state.values, path, curArr);
    render();
  });

  fs.appendChild(add);
  fs.appendChild(list);
  return fs;
}

function renderInlineOneOf(schemaRoot, node, path, ctx) {
  const wrap = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = ctx.label || "oneOf";
  wrap.appendChild(lg);

  const sel = document.createElement("select");
  node.oneOf.forEach((opt, i) => {
    const r = resolveSchema(schemaRoot, opt);
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = r.title || r.description || `option ${i + 1}`;
    sel.appendChild(o);
  });

  // Keep choice in a hidden meta key at this path
  const metaKey = "__oneOfIndex";
  const metaPath = [...path, metaKey];
  const chosen = deepGet(state.values, metaPath);
  sel.value = String(typeof chosen === "number" ? chosen : 0);

  sel.addEventListener("change", () => {
    deepSet(state.values, metaPath, Number(sel.value) || 0);
    // Reset actual value container at path when switching
    deepSet(state.values, path, undefined);
    render();
  });

  wrap.appendChild(fieldWrap("Choose shape", true, sel));

  const idx = Number(sel.value) || 0;
  const optSchema = resolveSchema(
    schemaRoot,
    node.oneOf[Math.max(0, Math.min(idx, node.oneOf.length - 1))]
  );
  wrap.appendChild(
    renderNode(schemaRoot, optSchema, path, {
      label: optSchema.title || "value",
      required: true,
    })
  );

  return wrap;
}

function renderBoolean(schemaRoot, node, path, ctx) {
  const input = document.createElement("input");
  input.type = "checkbox";
  const cur = deepGet(state.values, path);
  input.checked = (cur ?? node.default ?? false) === true;

  input.addEventListener("change", () => {
    deepSet(state.values, path, input.checked);
    updatePreviewAndValidate();
  });

  return fieldWrap(
    ctx.label || "boolean",
    ctx.required,
    input,
    node.description || ""
  );
}

function renderNumber(schemaRoot, node, path, ctx, kind) {
  const input = document.createElement("input");
  input.type = "number";
  if (typeof node.minimum === "number") input.min = String(node.minimum);
  if (typeof node.maximum === "number") input.max = String(node.maximum);
  input.step = kind === "integer" ? "1" : "any";

  const cur = deepGet(state.values, path);
  const v = cur ?? node.default;
  if (typeof v === "number") input.value = String(v);

  input.addEventListener("input", () => {
    const n = input.value === "" ? undefined : Number(input.value);
    deepSet(state.values, path, Number.isFinite(n) ? n : undefined);
    updatePreviewAndValidate();
  });

  if (Array.isArray(node.enum)) {
    const sel = document.createElement("select");
    node.enum.forEach((x) => {
      const o = document.createElement("option");
      o.value = String(x);
      o.textContent = String(x);
      sel.appendChild(o);
    });
    if (v != null) sel.value = String(v);
    sel.addEventListener("change", () => {
      deepSet(
        state.values,
        path,
        kind === "integer" ? parseInt(sel.value, 10) : Number(sel.value)
      );
      updatePreviewAndValidate();
    });
    return fieldWrap(
      ctx.label || kind,
      ctx.required,
      sel,
      node.description || ""
    );
  }

  return fieldWrap(
    ctx.label || kind,
    ctx.required,
    input,
    node.description || ""
  );
}

function renderString(schemaRoot, node, path, ctx) {
  // enum -> <select>
  if (Array.isArray(node.enum)) {
    const sel = document.createElement("select");
    node.enum.forEach((x) => {
      const o = document.createElement("option");
      o.value = String(x);
      o.textContent = String(x);
      sel.appendChild(o);
    });
    const cur = deepGet(state.values, path);
    const v = cur ?? node.default ?? node.enum[0];
    if (v != null) sel.value = String(v);

    sel.addEventListener("change", () => {
      deepSet(state.values, path, sel.value);
      updatePreviewAndValidate();
    });

    return fieldWrap(
      ctx.label || "string",
      ctx.required,
      sel,
      node.description || ""
    );
  }

  // long text -> textarea (heuristic)
  const useTextArea =
    (node.description && node.description.length > 60) ||
    (node.pattern && node.pattern.length > 30);
  const input = useTextArea
    ? document.createElement("textarea")
    : document.createElement("input");
  if (!useTextArea) input.type = "text";

  const cur = deepGet(state.values, path);
  const v = cur ?? node.default ?? "";
  input.value = typeof v === "string" ? v : "";

  input.addEventListener("input", () => {
    const val = input.value;
    deepSet(state.values, path, val === "" ? undefined : val);
    updatePreviewAndValidate();
  });

  const hints = [];
  if (node.description) hints.push(node.description);
  if (node.pattern) hints.push(`pattern: ${node.pattern}`);
  return fieldWrap(
    ctx.label || "string",
    ctx.required,
    input,
    hints.join(" | ")
  );
}

function defaultFor(node0, schemaRoot) {
  const node = resolveSchema(schemaRoot, node0);
  if (node.default !== undefined) return node.default;

  if (Array.isArray(node.oneOf) && node.oneOf.length)
    return defaultFor(node.oneOf[0], schemaRoot);
  if (Array.isArray(node.enum) && node.enum.length) return node.enum[0];

  const type = inferType(node);
  if (type === "object") {
    const out = {};
    const props = node.properties || {};
    const req = new Set(node.required || []);
    for (const [k, v] of Object.entries(props)) {
      if (req.has(k)) out[k] = defaultFor(v, schemaRoot);
    }
    // For map objects, start empty
    if (!Object.keys(props).length && node.additionalProperties) return {};
    return out;
  }
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return 0;
  return "";
}

function stripMeta(obj) {
  // Remove any internal helper keys (like __oneOfIndex)
  if (Array.isArray(obj)) return obj.map(stripMeta);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "__oneOfIndex") continue;
      if (v === undefined) continue;
      out[k] = stripMeta(v);
    }
    return out;
  }
  return obj;
}

function validateAgainst(schemaRoot, node0, value, pathStr, errs) {
  const node = resolveSchema(schemaRoot, node0);
  if (Array.isArray(node.oneOf) && node.oneOf.length) {
    // Minimal: validate against selected oneOf if stored
    const idx =
      value && typeof value === "object" && value.__oneOfIndex != null
        ? value.__oneOfIndex
        : 0;
    const opt = node.oneOf[Math.max(0, Math.min(idx, node.oneOf.length - 1))];
    return validateAgainst(schemaRoot, opt, value, pathStr, errs);
  }

  const type = inferType(node);

  if (value === undefined) {
    // required checking is handled at object level (below)
    return;
  }

  if (type === "object") {
    if (typeof value !== "object" || value == null || Array.isArray(value)) {
      errs.push(`${pathStr} must be an object`);
      return;
    }
    const props = node.properties || {};
    const req = node.required || [];
    for (const k of req) {
      if (value[k] === undefined) errs.push(`${pathStr}.${k} is required`);
    }
    for (const [k, sch] of Object.entries(props)) {
      if (value[k] !== undefined)
        validateAgainst(schemaRoot, sch, value[k], `${pathStr}.${k}`, errs);
    }
    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      errs.push(`${pathStr} must be an array`);
      return;
    }
    if (typeof node.minItems === "number" && value.length < node.minItems)
      errs.push(`${pathStr} minItems ${node.minItems}`);
    if (typeof node.maxItems === "number" && value.length > node.maxItems)
      errs.push(`${pathStr} maxItems ${node.maxItems}`);
    if (node.items)
      value.forEach((it, i) =>
        validateAgainst(schemaRoot, node.items, it, `${pathStr}[${i}]`, errs)
      );
    return;
  }

  if (type === "boolean") {
    if (typeof value !== "boolean") errs.push(`${pathStr} must be boolean`);
    return;
  }

  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value))
      errs.push(`${pathStr} must be a number`);
    if (type === "integer" && !Number.isInteger(value))
      errs.push(`${pathStr} must be an integer`);
    if (typeof node.minimum === "number" && value < node.minimum)
      errs.push(`${pathStr} minimum ${node.minimum}`);
    if (typeof node.maximum === "number" && value > node.maximum)
      errs.push(`${pathStr} maximum ${node.maximum}`);
    if (Array.isArray(node.enum) && !node.enum.includes(value))
      errs.push(`${pathStr} must be one of ${node.enum.join(", ")}`);
    return;
  }

  // string-ish
  if (typeof value !== "string") {
    errs.push(`${pathStr} must be a string`);
    return;
  }
  if (node.pattern) {
    try {
      const re = new RegExp(node.pattern);
      if (!re.test(value)) errs.push(`${pathStr} does not match pattern`);
    } catch {
      // ignore invalid regex in schema
    }
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value))
    errs.push(`${pathStr} must be one of ${node.enum.join(", ")}`);
}

function updatePreviewAndValidate() {
  if (!state.activeSchemaName) return;

  const schema = state.schemas.get(state.activeSchemaName);
  const root = pickRootSchema(schema);

  // Build final output object (strip undefined + meta keys)
  const out = stripMeta(state.values);
  const json = JSON.stringify(out, null, 2);
  jsonPreview.textContent = json;

  // Validate (minimal)
  const errs = [];
  validateAgainst(schema, root, out, "$", errs);

  errorsRoot.innerHTML = "";
  errs.slice(0, 25).forEach((e) => {
    const d = document.createElement("div");
    d.className = "errorItem";
    d.textContent = e;
    errorsRoot.appendChild(d);
  });

  copyBtn.disabled = false;
  downloadBtn.disabled = false;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[
        c
      ])
  );
}

// Events
schemaFilesInput.addEventListener("change", async () => {
  const files = Array.from(schemaFilesInput.files || []);
  if (!files.length) return;

  state.schemas.clear();
  for (const f of files) {
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      state.schemas.set(f.name, obj);
    } catch (e) {
      alert(`Failed to load ${f.name}: ${e}`);
    }
  }

  schemaSelect.innerHTML = "";
  for (const name of state.schemas.keys()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    schemaSelect.appendChild(opt);
  }

  schemaSelect.disabled = false;
  defaultsBtn.disabled = false;
  clearBtn.disabled = false;

  // activate first schema
  state.activeSchemaName = schemaSelect.value;
  state.activeOneOfIndex = 0;
  state.values = {};
  outName.value = guessOutputName(state.activeSchemaName);
  render();
});

schemaSelect.addEventListener("change", () => {
  state.activeSchemaName = schemaSelect.value;
  state.activeOneOfIndex = 0;
  state.values = {};
  outName.value = guessOutputName(state.activeSchemaName);
  render();
});

defaultsBtn.addEventListener("click", () => {
  if (!state.activeSchemaName) return;
  const schema = state.schemas.get(state.activeSchemaName);
  const root = pickRootSchema(schema);
  state.values = defaultFor(root, schema);
  render();
});

clearBtn.addEventListener("click", () => {
  state.values = {};
  render();
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(jsonPreview.textContent);
  } catch {
    alert("Clipboard write failed (browser permissions).");
  }
});

downloadBtn.addEventListener("click", () => {
  const name = (outName.value || "output.json").trim();
  const blob = new Blob([jsonPreview.textContent], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".json") ? name : `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2500);
});

resetBtn.addEventListener("click", () => {
  state.schemas.clear();
  state.activeSchemaName = null;
  state.activeOneOfIndex = 0;
  state.values = {};
  schemaSelect.innerHTML = "";
  schemaSelect.disabled = true;
  defaultsBtn.disabled = true;
  clearBtn.disabled = true;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  outName.value = "output.json";
  oneOfPicker.style.display = "none";
  render();
});

// initial
render();

"use strict";

/**
 * Configure these to match your repo.
 * If you don’t want remote loading, set USE_REMOTE=false and populate LOCAL_FILES.
 */
const CONFIG = {
  SITE_TITLE: "Minecraft 1.21.11",
  SITE_SUBTITLE: "Repo viewer",
  REPO_URL: "https://github.com/Mosberg/Minecraft-1.21.11",
  USE_REMOTE: false,

  // If USE_REMOTE=true, set these:
  REMOTE: {
    RAW_BASE: "https://raw.githubusercontent.com/Mosberg/Minecraft-1.21.11/main/"
  },

  // If USE_REMOTE=false, set local file paths that are served with the site:
  LOCAL_FILES: [
    "pack.mcmeta",
    "index.html",
    "styles.css",
    "app.js"
  ]
};

const el = (id) => document.getElementById(id);

const state = {
  files: [],
  filtered: [],
  currentPath: null
};

function loadPrefs() {
  const theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

  const sidebar = localStorage.getItem("sidebar");
  if (sidebar === "collapsed") document.body.dataset.sidebar = "collapsed";
}

function saveTheme(next) {
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || "dark";
  saveTheme(cur === "dark" ? "light" : "dark");
}

function toggleSidebar() {
  const collapsed = document.body.dataset.sidebar === "collapsed";
  if (collapsed) {
    delete document.body.dataset.sidebar;
    localStorage.setItem("sidebar", "expanded");
  } else {
    document.body.dataset.sidebar = "collapsed";
    localStorage.setItem("sidebar", "collapsed");
  }
  const btn = el("sidebarToggle");
  btn?.setAttribute("aria-expanded", String(!collapsed));
}

function setStatus(text) {
  el("statusLine").textContent = text;
}

function setFooter(rightText) {
  el("footerRight").textContent = rightText || "";
}

function normalizePath(p) {
  return String(p || "").replace(/^\/+/, "");
}

function fileUrlFor(path) {
  path = normalizePath(path);
  if (!path) return null;
  if (CONFIG.USE_REMOTE) return CONFIG.REMOTE.RAW_BASE + path;
  return "./" + path;
}

function renderTree() {
  const root = el("fileTree");
  root.textContent = "";

  for (const path of state.filtered) {
    const a = document.createElement("a");
    a.className = "tree__item";
    a.href = `#${encodeURIComponent(path)}`;
    a.dataset.path = path;

    const label = document.createElement("span");
    label.textContent = path;

    const badge = document.createElement("span");
    badge.className = "tree__badge";
    badge.textContent = path.includes(".") ? path.split(".").pop() : "file";

    a.append(label, badge);

    if (state.currentPath === path) a.setAttribute("aria-current", "page");

    root.appendChild(a);
  }
}

function applyFilter(query) {
  const q = (query || "").trim().toLowerCase();
  state.filtered = !q
    ? [...state.files]
    : state.files.filter(p => p.toLowerCase().includes(q));
  renderTree();
  setStatus(`${state.filtered.length}/${state.files.length} shown`);
}

async function fetchText(path) {
  const url = fileUrlFor(path);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.text();
}

function setViewer(path, text) {
  el("viewerPath").textContent = path || "—";
  el("codeText").textContent = text || "";

  const copyBtn = el("copyBtn");
  copyBtn.disabled = !text;

  const openRawBtn = el("openRawBtn");
  const url = fileUrlFor(path);
  if (url) {
    openRawBtn.href = url;
    openRawBtn.setAttribute("aria-disabled", "false");
  } else {
    openRawBtn.href = "#";
    openRawBtn.setAttribute("aria-disabled", "true");
  }

  // highlight selection in tree
  for (const node of el("fileTree").querySelectorAll(".tree__item")) {
    if (node.dataset.path === path) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  }
}

async function openPathFromHash() {
  const raw = decodeURIComponent((location.hash || "").slice(1));
  const path = normalizePath(raw);
  if (!path) {
    state.currentPath = null;
    setViewer(null, "Select a file from the sidebar.");
    return;
  }

  state.currentPath = path;

  try {
    setViewer(path, "Loading…");
    const text = await fetchText(path);
    setViewer(path, text);
    setFooter(path);
  } catch (e) {
    setViewer(path, `Error: ${e?.message || e}`);
  }
}

async function init() {
  loadPrefs();

  el("siteTitle").textContent = CONFIG.SITE_TITLE;
  el("siteSubtitle").textContent = CONFIG.SITE_SUBTITLE;
  el("repoLink").href = CONFIG.REPO_URL;

  el("themeToggle").addEventListener("click", toggleTheme);
  el("sidebarToggle").addEventListener("click", toggleSidebar);

  el("copyBtn").addEventListener("click", async () => {
    const text = el("codeText").textContent || "";
    await navigator.clipboard.writeText(text);
    el("copyBtn").textContent = "Copied";
    setTimeout(() => (el("copyBtn").textContent = "Copy"), 900);
  });

  el("searchInput").addEventListener("input", (e) => {
    applyFilter(e.target.value);
  });

  // populate file list
  state.files = CONFIG.USE_REMOTE ? [] : [...CONFIG.LOCAL_FILES];
  state.filtered = [...state.files];

  setStatus(`${state.filtered.length}/${state.files.length} shown`);
  renderTree();

  window.addEventListener("hashchange", openPathFromHash);
  await openPathFromHash();

  // If remote mode is enabled but no listing is implemented:
  if (CONFIG.USE_REMOTE && state.files.length === 0) {
    setStatus("Remote mode enabled; file listing not configured.");
    setViewer(null, "Remote mode is enabled, but the file list is empty.\n\nAdd a file index or switch USE_REMOTE=false.");
  }
}

init();
