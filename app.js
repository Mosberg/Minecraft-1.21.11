"use strict";

/**
 * Combined app.js
 * - Module A: Schema Form Builder (schemaFiles -> dynamic form -> JSON preview + minimal validation)
 * - Module B: Repo File Viewer (optional; only activates if viewer DOM exists)
 *
 * Design goals:
 * - No global name collisions (modules are scoped).
 * - Activates features only when required DOM nodes exist.
 * - Avoids duplicate IDs conflicts (e.g., #copyBtn) by detecting which UI is present.
 */

/* ------------------------------ Shared utils ------------------------------ */

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function debounce(fn, ms = 80) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

function tryJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function toArray(x) {
  return Array.isArray(x) ? x : (x == null ? [] : [x]);
}

/* -------------------------- Module A: Schema UI --------------------------- */

(function SchemaFormBuilderApp() {
  // Detect presence
  const schemaFilesInput = qs("#schemaFiles");
  const schemaSelect = qs("#schemaSelect");
  const outName = qs("#outName");
  const schemaMeta = qs("#schemaMeta");
  const oneOfPicker = qs("#oneOfPicker");
  const formRoot = qs("#formRoot");
  const jsonPreview = qs("#jsonPreview");
  const errorsRoot = qs("#errors");

  const defaultsBtn = qs("#defaultsBtn");
  const clearBtn = qs("#clearBtn");
  const copyBtn = qs("#copyBtn");       // may conflict with viewer; guarded
  const downloadBtn = qs("#downloadBtn");
  const resetBtn = qs("#loadExample");

  const hasSchemaUi =
    !!schemaFilesInput &&
    !!schemaSelect &&
    !!formRoot &&
    !!jsonPreview &&
    !!errorsRoot;

  if (!hasSchemaUi) return;

  const state = {
    schemas: new Map(), // filename -> schemaObject
    activeSchemaName: null,
    activeOneOfIndex: 0,
    values: {}, // in-progress values tree
    // keep oneOf selections out of output tree to avoid polluting JSON
    inlineOneOf: new Map() // pathKey -> index
  };

  function pathKey(path) {
    // stable key for meta maps
    return path.map(String).join("/");
  }

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
    if (parent && typeof parent === "object") delete parent[path[path.length - 1]];
  }

  function jsonPointerGet(root, pointer) {
    const p = pointer.startsWith("#") ? pointer.slice(1) : pointer;
    const parts = p
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
    return deepGet(root, parts);
  }

  function resolveSchema(schemaRoot, node) {
    if (!node || typeof node !== "object") return node;
    if (node.$ref && typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
      const target = jsonPointerGet(schemaRoot, node.$ref);
      if (!target) return node;
      const { $ref, ...rest } = node;
      // referenced schema + local overrides (local wins)
      return { ...target, ...rest };
    }
    return node;
  }

  function mergeSchemas(a, b) {
    // minimal merge for common allOf usage
    const out = { ...a, ...b };
    if (a.properties || b.properties)
      out.properties = { ...(a.properties || {}), ...(b.properties || {}) };
    if (a.required || b.required)
      out.required = Array.from(new Set([...(a.required || []), ...(b.required || [])]));
    // naive merge of dependentRequired / etc could be added later
    return out;
  }

  function pickRootSchema(schema) {
    if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
      const idx = state.activeOneOfIndex ?? 0;
      const clamped = Math.max(0, Math.min(idx, schema.oneOf.length - 1));
      return resolveSchema(schema, schema.oneOf[clamped]);
    }
    return schema;
  }

  function schemaTitle(schema) {
    return schema.title || schema.$id || "(untitled schema)";
  }

  function guessOutputName(schemaName) {
    const n = schemaName.replace(/\.schema\.json$/i, ".json");
    return n === schemaName ? "output.json" : n;
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

  function render() {
    const schemaName = state.activeSchemaName;
    if (!schemaName) {
      formRoot.textContent = "Load schemas to begin.";
      formRoot.classList.add("muted");
      jsonPreview.textContent = "{}";
      schemaMeta.textContent = "";
      if (oneOfPicker) oneOfPicker.style.display = "none";
      errorsRoot.innerHTML = "";
      return;
    }

    const schema = state.schemas.get(schemaName);
    const root = pickRootSchema(schema);

    schemaMeta.innerHTML = [
      schema.title ? `<div><strong>${escapeHtml(schema.title)}</strong></div>` : "",
      schema.description ? `<div>${escapeHtml(schema.description)}</div>` : "",
      schema.$id ? `<div class="hint">$id: <code>${escapeHtml(schema.$id)}</code></div>` : "",
      schema.$schema ? `<div class="hint">$schema: <code>${escapeHtml(schema.$schema)}</code></div>` : ""
    ].filter(Boolean).join("");

    renderOneOfPicker(schema);

    formRoot.classList.remove("muted");
    formRoot.innerHTML = "";
    const form = document.createElement("div");
    form.appendChild(renderNode(schema, root, [], { label: schemaTitle(schema), required: true }));
    formRoot.appendChild(form);

    updatePreviewAndValidate();
  }

  function renderOneOfPicker(schema) {
    if (!oneOfPicker) return;

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
          (resolved.required?.includes("variants") ? "variants" :
           resolved.required?.includes("multipart") ? "multipart" :
           `option ${i + 1}`);
        o.value = String(i);
        o.textContent = `${i + 1}: ${title}`;
        if (i === state.activeOneOfIndex) o.selected = true;
        sel.appendChild(o);
      });

      sel.addEventListener("change", () => {
        state.activeOneOfIndex = Number(sel.value) || 0;
        state.values = {};
        state.inlineOneOf.clear();
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

    // allOf composition (minimal)
    if (Array.isArray(node.allOf) && node.allOf.length) {
      node = node.allOf
        .map((x) => resolveSchema(schemaRoot, x))
        .reduce((acc, cur) => mergeSchemas(acc, cur), {});
    }

    // inline oneOf (field-level)
    if (Array.isArray(node.oneOf) && node.oneOf.length) {
      return renderInlineOneOf(schemaRoot, node, path, ctx);
    }

    const type = inferType(node);
    if (type === "object") return renderObject(schemaRoot, node, path, ctx);
    if (type === "array") return renderArray(schemaRoot, node, path, ctx);
    if (type === "boolean") return renderBoolean(schemaRoot, node, path, ctx);
    if (type === "number" || type === "integer") return renderNumber(schemaRoot, node, path, ctx, type);
    return renderString(schemaRoot, node, path, ctx);
  }

  function renderObject(schemaRoot, node, path, ctx) {
    const fs = document.createElement("fieldset");
    const lg = document.createElement("legend");
    lg.textContent = ctx.label || "object";
    fs.appendChild(lg);

    const props = node.properties || {};
    const requiredSet = new Set(node.required || []);

    const hasNamedProps = Object.keys(props).length > 0;
    const hasMap = !!node.additionalProperties;

    // "pure map" object: no named props, but additionalProperties present
    if (!hasNamedProps && hasMap) {
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
      Object.entries(curObj).forEach(([k]) => {
        const row = document.createElement("div");
        row.className = "kvRow";

        const keyInput = document.createElement("input");
        keyInput.type = "text";
        keyInput.value = k;
        keyInput.addEventListener("change", () => {
          const obj = deepGet(state.values, path) ?? {};
          const nextKey = keyInput.value.trim();
          if (!nextKey) return;
          if (nextKey !== k) {
            obj[nextKey] = obj[k];
            delete obj[k];
            deepSet(state.values, path, obj);
            render();
          }
        });

        const valNode = renderNode(schemaRoot, ap, [...path, k], { label: "Value", required: true });

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

      const child = renderNode(schemaRoot, propSchema, [...path, prop], {
        label: prop,
        required: req
      });

      fs.appendChild(child);

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
          // no full render needed
        });

        row.appendChild(unset);
        fs.appendChild(row);
      }
    }

    // If object supports additionalProperties AND has named props, expose optional map editor
    if (hasNamedProps && hasMap) {
      const ap = resolveSchema(schemaRoot, node.additionalProperties);
      const mapPath = [...path, "__additionalProperties"];
      const title = document.createElement("div");
      title.className = "hint";
      title.textContent = "Additional properties (map):";
      fs.appendChild(title);

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn smallBtn";
      addBtn.textContent = "Add extra property";
      addBtn.addEventListener("click", () => {
        const key = prompt("Property name?");
        if (!key) return;
        const cur = deepGet(state.values, mapPath) ?? {};
        cur[key] = defaultFor(ap, schemaRoot);
        deepSet(state.values, mapPath, cur);
        render();
      });
      fs.appendChild(addBtn);

      const curExtra = deepGet(state.values, mapPath) ?? {};
      Object.entries(curExtra).forEach(([k]) => {
        const row = document.createElement("div");
        row.className = "kvRow";

        const keyInput = document.createElement("input");
        keyInput.type = "text";
        keyInput.value = k;

        const valNode = renderNode(schemaRoot, ap, [...mapPath, k], { label: "Value", required: true });

        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn smallBtn secondary";
        del.textContent = "Remove";
        del.addEventListener("click", () => {
          const obj = deepGet(state.values, mapPath) ?? {};
          delete obj[k];
          deepSet(state.values, mapPath, obj);
          render();
        });

        row.appendChild(fieldWrap("Key", true, keyInput));
        row.appendChild(valNode);
        row.appendChild(del);
        fs.appendChild(row);
      });
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
        required: true
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn smallBtn secondary";
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        const curArr = Array.isArray(deepGet(state.values, path)) ? deepGet(state.values, path) : [];
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
      const curArr = Array.isArray(deepGet(state.values, path)) ? deepGet(state.values, path) : [];
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

    const pk = pathKey(path);
    const chosen = state.inlineOneOf.get(pk);
    sel.value = String(typeof chosen === "number" ? chosen : 0);

    sel.addEventListener("change", () => {
      state.inlineOneOf.set(pk, Number(sel.value) || 0);
      // reset concrete value at this path when switching shapes
      deepDelete(state.values, path);
      render();
    });

    wrap.appendChild(fieldWrap("Choose shape", true, sel));

    const idx = Number(sel.value) || 0;
    const clamped = Math.max(0, Math.min(idx, node.oneOf.length - 1));
    const optSchema = resolveSchema(schemaRoot, node.oneOf[clamped]);

    wrap.appendChild(
      renderNode(schemaRoot, optSchema, path, {
        label: optSchema.title || "value",
        required: true
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

    return fieldWrap(ctx.label || "boolean", ctx.required, input, node.description || "");
  }

  function renderNumber(schemaRoot, node, path, ctx, kind) {
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
        const raw = sel.value;
        const parsed = kind === "integer" ? parseInt(raw, 10) : Number(raw);
        deepSet(state.values, path, Number.isFinite(parsed) ? parsed : undefined);
        updatePreviewAndValidate();
      });

      return fieldWrap(ctx.label || kind, ctx.required, sel, node.description || "");
    }

    const input = document.createElement("input");
    input.type = "number";
    if (typeof node.minimum === "number") input.min = String(node.minimum);
    if (typeof node.maximum === "number") input.max = String(node.maximum);
    input.step = kind === "integer" ? "1" : "any";

    const cur = deepGet(state.values, path);
    const v = cur ?? node.default;
    if (typeof v === "number" && Number.isFinite(v)) input.value = String(v);

    input.addEventListener("input", () => {
      const n = input.value === "" ? undefined : Number(input.value);
      deepSet(state.values, path, Number.isFinite(n) ? n : undefined);
      updatePreviewAndValidate();
    });

    const hints = [];
    if (node.description) hints.push(node.description);
    if (typeof node.minimum === "number") hints.push(`min: ${node.minimum}`);
    if (typeof node.maximum === "number") hints.push(`max: ${node.maximum}`);

    return fieldWrap(ctx.label || kind, ctx.required, input, hints.join(" | "));
  }

  function renderString(schemaRoot, node, path, ctx) {
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

      return fieldWrap(ctx.label || "string", ctx.required, sel, node.description || "");
    }

    const useTextArea =
      (node.description && node.description.length > 60) ||
      (node.pattern && String(node.pattern).length > 30);

    const input = useTextArea ? document.createElement("textarea") : document.createElement("input");
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

    return fieldWrap(ctx.label || "string", ctx.required, input, hints.join(" | "));
  }

  function defaultFor(node0, schemaRoot) {
    const node = resolveSchema(schemaRoot, node0);
    if (node.default !== undefined) return node.default;

    if (Array.isArray(node.oneOf) && node.oneOf.length) return defaultFor(node.oneOf[0], schemaRoot);
    if (Array.isArray(node.enum) && node.enum.length) return node.enum[0];

    const type = inferType(node);
    if (type === "object") {
      const out = {};
      const props = node.properties || {};
      const req = new Set(node.required || []);
      for (const [k, v] of Object.entries(props)) {
        if (req.has(k)) out[k] = defaultFor(v, schemaRoot);
      }
      if (!Object.keys(props).length && node.additionalProperties) return {};
      return out;
    }
    if (type === "array") return [];
    if (type === "boolean") return false;
    if (type === "integer" || type === "number") {
      if (typeof node.minimum === "number") return node.minimum;
      return 0;
    }
    return "";
  }

  function buildFinalOutput(value) {
    // Remove undefined entries; merge additionalProperties map bucket; recurse
    if (Array.isArray(value)) return value.map(buildFinalOutput).filter((v) => v !== undefined);

    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        if (k === "__additionalProperties") continue;
        const built = buildFinalOutput(v);
        if (built !== undefined) out[k] = built;
      }
      // merge extras
      if (value.__additionalProperties && typeof value.__additionalProperties === "object") {
        for (const [k, v] of Object.entries(value.__additionalProperties)) {
          if (v === undefined) continue;
          out[k] = buildFinalOutput(v);
        }
      }
      return out;
    }

    return value;
  }

  function validateAgainst(schemaRoot, node0, value, pathStr, errs) {
    const node = resolveSchema(schemaRoot, node0);

    // inline oneOf: validate against selected index (stored in state.inlineOneOf)
    if (Array.isArray(node.oneOf) && node.oneOf.length) {
      const idx = state.inlineOneOf.get(pathStr) ?? 0;
      const clamped = Math.max(0, Math.min(idx, node.oneOf.length - 1));
      return validateAgainst(schemaRoot, node.oneOf[clamped], value, pathStr, errs);
    }

    const type = inferType(node);

    if (value === undefined) return;

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

      // validate named properties
      for (const [k, sch] of Object.entries(props)) {
        if (value[k] !== undefined) validateAgainst(schemaRoot, sch, value[k], `${pathStr}.${k}`, errs);
      }

      // validate additionalProperties if present (best-effort)
      if (node.additionalProperties && typeof node.additionalProperties === "object") {
        const ap = resolveSchema(schemaRoot, node.additionalProperties);
        for (const [k, v] of Object.entries(value)) {
          if (props[k]) continue;
          validateAgainst(schemaRoot, ap, v, `${pathStr}.${k}`, errs);
        }
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
      if (node.items) {
        value.forEach((it, i) => validateAgainst(schemaRoot, node.items, it, `${pathStr}[${i}]`, errs));
      }
      return;
    }

    if (type === "boolean") {
      if (typeof value !== "boolean") errs.push(`${pathStr} must be boolean`);
      return;
    }

    if (type === "number" || type === "integer") {
      if (typeof value !== "number" || Number.isNaN(value)) errs.push(`${pathStr} must be a number`);
      if (type === "integer" && !Number.isInteger(value)) errs.push(`${pathStr} must be an integer`);
      if (typeof node.minimum === "number" && value < node.minimum) errs.push(`${pathStr} minimum ${node.minimum}`);
      if (typeof node.maximum === "number" && value > node.maximum) errs.push(`${pathStr} maximum ${node.maximum}`);
      if (Array.isArray(node.enum) && !node.enum.includes(value)) errs.push(`${pathStr} must be one of ${node.enum.join(", ")}`);
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
        // ignore invalid regex
      }
    }
    if (Array.isArray(node.enum) && !node.enum.includes(value))
      errs.push(`${pathStr} must be one of ${node.enum.join(", ")}`);
  }

  const updatePreviewAndValidate = debounce(() => {
    if (!state.activeSchemaName) return;
    const schema = state.schemas.get(state.activeSchemaName);
    const root = pickRootSchema(schema);

    const out = buildFinalOutput(state.values);
    const json = JSON.stringify(out ?? {}, null, 2);
    jsonPreview.textContent = json;

    const errs = [];
    validateAgainst(schema, root, out, "$", errs);

    errorsRoot.innerHTML = "";
    errs.slice(0, 25).forEach((e) => {
      const d = document.createElement("div");
      d.className = "errorItem";
      d.textContent = e;
      errorsRoot.appendChild(d);
    });

    // Enable export actions
    if (copyBtn) copyBtn.disabled = false;
    if (downloadBtn) downloadBtn.disabled = false;
  }, 60);

  /* ------------------------------ Events ------------------------------ */

  schemaFilesInput.addEventListener("change", async () => {
    const files = Array.from(schemaFilesInput.files || []);
    if (!files.length) return;

    state.schemas.clear();
    state.inlineOneOf.clear();

    for (const f of files) {
      const text = await f.text();
      const parsed = tryJsonParse(text);
      if (!parsed.ok) {
        alert(`Failed to load ${f.name}: ${parsed.error}`);
        continue;
      }
      state.schemas.set(f.name, parsed.value);
    }

    schemaSelect.innerHTML = "";
    for (const name of state.schemas.keys()) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      schemaSelect.appendChild(opt);
    }

    schemaSelect.disabled = state.schemas.size === 0;
    if (defaultsBtn) defaultsBtn.disabled = state.schemas.size === 0;
    if (clearBtn) clearBtn.disabled = state.schemas.size === 0;

    state.activeSchemaName = schemaSelect.value || null;
    state.activeOneOfIndex = 0;
    state.values = {};
    if (outName) outName.value = state.activeSchemaName ? guessOutputName(state.activeSchemaName) : "output.json";

    render();
  });

  schemaSelect.addEventListener("change", () => {
    state.activeSchemaName = schemaSelect.value;
    state.activeOneOfIndex = 0;
    state.inlineOneOf.clear();
    state.values = {};
    if (outName) outName.value = guessOutputName(state.activeSchemaName);
    render();
  });

  if (defaultsBtn) {
    defaultsBtn.addEventListener("click", () => {
      if (!state.activeSchemaName) return;
      const schema = state.schemas.get(state.activeSchemaName);
      const root = pickRootSchema(schema);
      state.values = defaultFor(root, schema);
      state.inlineOneOf.clear();
      render();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.values = {};
      state.inlineOneOf.clear();
      render();
    });
  }

  // #copyBtn may be shared with viewer; only bind to JSON-copy if there is no viewer code node
  if (copyBtn) {
    const hasViewerCode = !!qs("#codeText");
    if (!hasViewerCode) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(jsonPreview.textContent || "{}");
        } catch {
          alert("Clipboard write failed (browser permissions).");
        }
      });
    } else {
      console.warn("Both schema UI and viewer UI detected; #copyBtn not bound to schema copy to avoid conflicts.");
    }
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const name = ((outName && outName.value) || "output.json").trim() || "output.json";
      const blob = new Blob([jsonPreview.textContent || "{}"], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = name.endsWith(".json") ? name : `${name}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 2500);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.schemas.clear();
      state.inlineOneOf.clear();
      state.activeSchemaName = null;
      state.activeOneOfIndex = 0;
      state.values = {};

      schemaSelect.innerHTML = "";
      schemaSelect.disabled = true;

      if (defaultsBtn) defaultsBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;
      if (downloadBtn) downloadBtn.disabled = true;

      if (outName) outName.value = "output.json";
      if (oneOfPicker) oneOfPicker.style.display = "none";
      render();
    });
  }

  render();
})();

/* ------------------------ Module B: Repo Viewer UI ------------------------ */

(function RepoViewerApp() {
  // Detect presence
  const fileTree = qs("#fileTree");
  const viewerPath = qs("#viewerPath");
  const codeText = qs("#codeText");
  const statusLine = qs("#statusLine");
  const footerRight = qs("#footerRight");

  const hasViewerUi = !!fileTree && !!viewerPath && !!codeText && !!statusLine;
  if (!hasViewerUi) return;

  const CONFIG = {
    SITE_TITLE: "Minecraft 1.21.11",
    SITE_SUBTITLE: "Repo viewer",
    REPO_URL: "https://github.com/Mosberg/Minecraft-1.21.11",
    USE_REMOTE: false,
    REMOTE: {
      RAW_BASE: "https://raw.githubusercontent.com/Mosberg/Minecraft-1.21.11/main/"
    },
    LOCAL_FILES: [
      "pack.mcmeta",
      "index.html",
      "styles.css",
      "app.js"
    ]
  };

  const viewerState = {
    files: [],
    filtered: [],
    currentPath: null
  };

  const byId = (id) => document.getElementById(id);
  const sidebarToggle = byId("sidebarToggle");
  const themeToggle = byId("themeToggle");
  const repoLink = byId("repoLink");
  const siteTitle = byId("siteTitle");
  const siteSubtitle = byId("siteSubtitle");
  const searchInput = byId("searchInput");
  const copyBtn = byId("copyBtn");     // may conflict with schema UI; guarded below
  const openRawBtn = byId("openRawBtn");

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
    sidebarToggle?.setAttribute("aria-expanded", String(!collapsed));
  }

  function setStatus(text) {
    statusLine.textContent = text;
  }

  function setFooter(rightText) {
    if (footerRight) footerRight.textContent = rightText || "";
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
    fileTree.textContent = "";

    for (const path of viewerState.filtered) {
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

      if (viewerState.currentPath === path) a.setAttribute("aria-current", "page");
      fileTree.appendChild(a);
    }
  }

  function applyFilter(query) {
    const q = (query || "").trim().toLowerCase();
    viewerState.filtered = !q ? [...viewerState.files] : viewerState.files.filter((p) => p.toLowerCase().includes(q));
    renderTree();
    setStatus(`${viewerState.filtered.length}/${viewerState.files.length} shown`);
  }

  async function fetchText(path) {
    const url = fileUrlFor(path);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return await res.text();
  }

  function setViewer(path, text) {
    viewerPath.textContent = path || "—";
    codeText.textContent = text || "";

    if (openRawBtn) {
      const url = fileUrlFor(path);
      if (url) {
        openRawBtn.href = url;
        openRawBtn.setAttribute("aria-disabled", "false");
      } else {
        openRawBtn.href = "#";
        openRawBtn.setAttribute("aria-disabled", "true");
      }
    }

    // highlight selection
    for (const node of qsa(".tree__item", fileTree)) {
      if (node.dataset.path === path) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    }
  }

  async function openPathFromHash() {
    const raw = decodeURIComponent((location.hash || "").slice(1));
    const path = normalizePath(raw);
    if (!path) {
      viewerState.currentPath = null;
      setViewer(null, "Select a file from the sidebar.");
      return;
    }

    viewerState.currentPath = path;

    try {
      setViewer(path, "Loading…");
      const text = await fetchText(path);
      setViewer(path, text);
      setFooter(path);
    } catch (e) {
      setViewer(path, `Error: ${e?.message || e}`);
    }
  }

  function bindCopyButton() {
    // If schema UI is present too, do not bind #copyBtn here to avoid conflicts
    const hasSchemaUi = !!qs("#jsonPreview");
    if (!copyBtn || hasSchemaUi) {
      if (hasSchemaUi) console.warn("Both schema UI and viewer UI detected; #copyBtn not bound to viewer copy to avoid conflicts.");
      return;
    }
    copyBtn.addEventListener("click", async () => {
      const text = codeText.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 900);
      } catch {
        alert("Clipboard write failed (browser permissions).");
      }
    });
  }

  async function init() {
    loadPrefs();

    if (siteTitle) siteTitle.textContent = CONFIG.SITE_TITLE;
    if (siteSubtitle) siteSubtitle.textContent = CONFIG.SITE_SUBTITLE;
    if (repoLink) repoLink.href = CONFIG.REPO_URL;

    themeToggle?.addEventListener("click", toggleTheme);
    sidebarToggle?.addEventListener("click", toggleSidebar);

    searchInput?.addEventListener("input", (e) => applyFilter(e.target.value));

    // populate file list
    viewerState.files = CONFIG.USE_REMOTE ? [] : [...CONFIG.LOCAL_FILES];
    viewerState.filtered = [...viewerState.files];

    setStatus(`${viewerState.filtered.length}/${viewerState.files.length} shown`);
    renderTree();

    window.addEventListener("hashchange", openPathFromHash);
    await openPathFromHash();

    if (CONFIG.USE_REMOTE && viewerState.files.length === 0) {
      setStatus("Remote mode enabled; file listing not configured.");
      setViewer(null, "Remote mode is enabled, but the file list is empty.\n\nAdd a file index or switch USE_REMOTE=false.");
    }

    bindCopyButton();
  }

  init();
})();
