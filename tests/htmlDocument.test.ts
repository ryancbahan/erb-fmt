import fs from "fs";
import { describe, expect, it } from "vitest";
import { parseERB } from "../src/parser.js";
import { buildPlaceholderDocument } from "../src/formatter/placeholders.js";
import {
  analyzePlaceholderDocument,
  renderHtmlDocument,
} from "../src/formatter/htmlDocument.js";

describe("html document analysis", () => {
  it("produces structured HTML with placeholder-aware indentation", () => {
    const source = fs.readFileSync(
      "examples/dashboard-unformatted.erb",
      "utf8",
    );
    const parsed = parseERB(source);
    const placeholderDocument = buildPlaceholderDocument(parsed.regions);
    const analysis = analyzePlaceholderDocument(placeholderDocument);
    const rendered = renderHtmlDocument(
      analysis,
      placeholderDocument.html,
      2,
      "space",
      "conservative",
      80,
      "auto",
    );

    expect(rendered.html).toMatchInlineSnapshot(`
      "<div
        class="dashboard"
        data-owner="__ERB_PLACEHOLDER_0__"
        data-project-count="__ERB_PLACEHOLDER_1__"
        data-theme="__ERB_PLACEHOLDER_2__"
      >
        __ERB_PLACEHOLDER_3__
        <div
          class="project-card"
          id="project-__ERB_PLACEHOLDER_4__"
          data-state="__ERB_PLACEHOLDER_5__"
          data-tags="__ERB_PLACEHOLDER_6__"
          data-featured="__ERB_PLACEHOLDER_7__"
        >
          <header class="card-header" data-empty="__ERB_PLACEHOLDER_8__">
            <h2 title="__ERB_PLACEHOLDER_9__">
              <span class="icon __ERB_PLACEHOLDER_10__"></span>
              __ERB_PLACEHOLDER_11__
            </h2>
            <div
              class="metadata"
              data-owner="__ERB_PLACEHOLDER_12__"
              data-due="__ERB_PLACEHOLDER_13__"
              data-budget="__ERB_PLACEHOLDER_14__"
              data-flags="__ERB_PLACEHOLDER_15__"
            >
              <span class="owner">__ERB_PLACEHOLDER_16__</span>
              <span class="due" data-kind="date">__ERB_PLACEHOLDER_17__</span>
              <span
                class="budget"
                data-currency="USD"
              >__ERB_PLACEHOLDER_18__</span>
            </div>
          </header>
          <section class="card-body">
            <ul
              class="task-list"
              data-count="__ERB_PLACEHOLDER_19__"
              data-has-overdue="__ERB_PLACEHOLDER_20__"
              data-random="__ERB_PLACEHOLDER_21__"
            >
              __ERB_PLACEHOLDER_22__
              <li
                class="task __ERB_PLACEHOLDER_23__"
                data-index="__ERB_PLACEHOLDER_24__"
                data-id="__ERB_PLACEHOLDER_25__"
                data-tags="__ERB_PLACEHOLDER_26__"
              >
                <span class="title" data-priority="__ERB_PLACEHOLDER_27__">__ERB_PLACEHOLDER_28__</span>
                <span class="assignee" data-role="__ERB_PLACEHOLDER_29__">__ERB_PLACEHOLDER_30__</span>
                <div class="flags" data-flags="__ERB_PLACEHOLDER_31__">
                  __ERB_PLACEHOLDER_32__
                  <span
                    class="flag flag-__ERB_PLACEHOLDER_33__"
                    data-flag="__ERB_PLACEHOLDER_34__"
                  >__ERB_PLACEHOLDER_35__</span>
                  __ERB_PLACEHOLDER_36__
                </div>
                __ERB_PLACEHOLDER_37__
                <details
                  class="notes"
                  data-length="__ERB_PLACEHOLDER_38__"
                  data-trimmed="__ERB_PLACEHOLDER_39__"
                >
                  <summary>Notes</summary>
                  <pre class="note-body" data-source="__ERB_PLACEHOLDER_40__">
      __ERB_PLACEHOLDER_41__
                  </pre>
                </details>
                __ERB_PLACEHOLDER_42__
                <span class="notes-placeholder">No additional notes</span>
                __ERB_PLACEHOLDER_43__
              </li>
              __ERB_PLACEHOLDER_44__
              <li
                class="task summary"
                data-summary="true"
                data-id="summary-__ERB_PLACEHOLDER_45__"
                data-total-duration="__ERB_PLACEHOLDER_46__"
                data-completed="__ERB_PLACEHOLDER_47__"
              >
                <span>Total time logged:</span>
                <strong>__ERB_PLACEHOLDER_48__</strong>
                <span class="completed" data-completed="__ERB_PLACEHOLDER_49__">Completed: __ERB_PLACEHOLDER_50__</span>
              </li>
              <li
                class="task metrics"
                data-summary="secondary"
                data-id="metrics-__ERB_PLACEHOLDER_51__"
              >
                <span class="velocity">Velocity: __ERB_PLACEHOLDER_52__</span>
                <span class="health" data-health="__ERB_PLACEHOLDER_53__">Health: __ERB_PLACEHOLDER_54__</span>
                <span class="risk" data-risk="__ERB_PLACEHOLDER_55__">Risk: __ERB_PLACEHOLDER_56__</span>
              </li>
            </ul>
          </section>
          <footer
            class="card-footer"
            data-created="__ERB_PLACEHOLDER_57__"
            data-updated="__ERB_PLACEHOLDER_58__"
            data-links="view,edit,archive"
          >
            <a
              class="btn btn-sm"
              href="__ERB_PLACEHOLDER_59__"
              data-action="view"
              data-hotkey="v"
            >View Project</a>
            <a
              class="btn btn-sm"
              href="__ERB_PLACEHOLDER_60__"
              data-action="edit"
              data-enabled="__ERB_PLACEHOLDER_61__"
            >Edit</a>
            <button
              class="btn btn-sm"
              data-action="archive"
              data-confirm="Are you sure you want to archive __ERB_PLACEHOLDER_62__?"
              data-enabled="__ERB_PLACEHOLDER_63__"
            >Archive</button>
          </footer>
        </div>
        __ERB_PLACEHOLDER_64__
      </div>
      "
    `);

    expect(rendered.placeholderPrintInfo.length).toBeGreaterThan(0);
    rendered.placeholderPrintInfo.forEach((info) => {
      expect(info.indentationLevel).toBeGreaterThanOrEqual(0);
    });
  });

  it("handles HTML comments and irregular markup without losing placeholders", () => {
    const snippet = `<div><!-- before --><span class="item"><%= value %></span><!-- after --></div>`;
    const parsed = parseERB(snippet);
    const placeholderDocument = buildPlaceholderDocument(parsed.regions);
    const analysis = analyzePlaceholderDocument(placeholderDocument);
    const rendered = renderHtmlDocument(
      analysis,
      placeholderDocument.html,
      2,
      "space",
      "conservative",
      80,
      "auto",
    );

    expect(rendered.html).toContain("__ERB_PLACEHOLDER_0__");
    expect(rendered.html.trim().startsWith("<div")).toBe(true);
    expect(analysis.diagnostics).toEqual([]);
  });
});
