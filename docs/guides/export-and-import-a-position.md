# How to export and import a position

This guide shows you how to carry where an execution stands out of one compile
of its chart and into a new compile, with `exportPosition` and
`importPosition`.

You start with an execution of a library loan that has been lent and renewed
once, and a next version of the loan chart that adds a lost copy. A line
ending in `// =>` shows the value that expression answers.

```ts
import { compile, configuration, exportPosition, importPosition, isDone, start, step } from "@riddler/statifier";

const loanVersion3 = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
  <datamodel><data id="renewals" expr="0"/></datamodel>
  <state id="on_loan">
    <onentry><send id="due" event="loan.due" delay="14d"/></onentry>
    <onexit><cancel sendid="due"/></onexit>
    <transition event="loan.renew" cond="renewals &lt; 2" target="on_loan">
      <assign location="renewals" expr="renewals + 1"/>
    </transition>
    <transition event="loan.due" target="overdue"/>
    <transition event="loan.returned" target="returned"/>
  </state>
  <state id="overdue"><transition event="loan.returned" target="returned"/></state>
  <final id="returned"/>
</scxml>`;

const loanVersion4 = loanVersion3
  .replace(
    `<state id="overdue">`,
    `<state id="overdue"><transition event="loan.lost" target="lost"/>`,
  )
  .replace(
    `<final id="returned"/>`,
    `<final id="returned"/><final id="lost"><donedata><param name="renewals" expr="renewals"/></donedata></final>`,
  );

function chartOf(source: string, chartVersion: string) {
  const compiled = compile(source, { chartName: "loan", chartVersion });
  if (!compiled.ok) throw new Error("the loan chart does not compile");
  return compiled.chart;
}

const loan = chartOf(loanVersion3, "3");
const lent = start(loan, { sessionId: "loan-copy-18" });
if (!lent.ok) throw new Error(lent.reason);
const renewed = step(loan, lent.state, { name: "loan.renew" });
if (!renewed.ok) throw new Error(renewed.reason);
```

## Steps

1. Export the position from the execution's latest state.

   ```ts
   const exported = exportPosition(renewed.state);
   if (!exported.ok) throw new Error(exported.reason);
   exported.position.configuration; // => ["on_loan"]
   exported.position.datamodel.renewals; // => "1"
   ```

2. Write the position as JSON text wherever you keep it.

   ```ts
   const stored = JSON.stringify(exported.position);
   JSON.parse(stored).identity.version; // => "3"
   ```

3. Compile the next version of the chart.

   ```ts
   const loanNext = chartOf(loanVersion4, "4");
   loanNext.identity.version; // => "4"
   ```

4. Parse the stored text and import it into the new compile.

   ```ts
   const imported = importPosition(loanNext, JSON.parse(stored));
   if (!imported.ok) throw new Error(imported.reason);
   configuration(imported.state); // => ["on_loan"]
   ```

5. Check that the imported state holds no pending timer, and schedule the loan's due date on your own clock.

   ```ts
   imported.state.timers; // => []
   ```

6. When your clock reaches the due date, deliver the due event to the imported state.

   ```ts
   const lapsed = step(loanNext, imported.state, { name: "loan.due" });
   if (!lapsed.ok) throw new Error(lapsed.reason);
   configuration(lapsed.state); // => ["overdue"]
   ```

7. Deliver an event that only the new version handles.

   ```ts
   const lost = step(loanNext, lapsed.state, { name: "loan.lost" });
   if (!lost.ok) throw new Error(lost.reason);
   isDone(lost.state); // => { ok: true, done: true, donedata: { renewals: 1 }, configuration: ["lost"] }
   ```

If the new version no longer holds a state the position names, the import
answers `unknown_state_ids` with every missing id, and you map those states
before you import again.

```ts
const renamed = chartOf(loanVersion4.replaceAll(`"on_loan"`, `"lent"`), "5");
importPosition(renamed, JSON.parse(stored)); // => { ok: false, reason: "unknown_state_ids", ids: ["on_loan"] }
```

## See also

- [Position export and import](https://github.com/riddler/statifier-ts/blob/main/README.md#position-export-and-import): what the export and the import answer, and every refusal.
- [The state](https://github.com/riddler/statifier-ts/blob/main/README.md#the-state): the fields of the state a call answers.
