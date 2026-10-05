# How to drive an execution with the six calls

This guide shows you how to take a chart from its SCXML source to a stopped
execution with `compile`, `start`, `step`, `advance`, `configuration` and
`isDone`.

You start with `@riddler/statifier` installed and a chart's SCXML source in a
string. The chart here is a library loan: a copy lent for fourteen days,
renewed up to twice, overdue when the loan runs out, and returned. A line
ending in `// =>` shows the value that expression answers.

```ts
import { advance, compile, configuration, isDone, start, step } from "@riddler/statifier";

const loanSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
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
  <final id="returned"><donedata><param name="renewals" expr="renewals"/></donedata></final>
</scxml>`;
```

## Steps

1. Compile the chart once and keep the compiled chart for every later call.

   ```ts
   const compiled = compile(loanSource, { chartName: "loan", chartVersion: "3" });
   if (!compiled.ok) throw new Error("the loan chart does not compile");
   const loan = compiled.chart;
   compiled.ok; // => true
   ```

2. Start an execution with a session id you mint.

   ```ts
   const lent = start(loan, { sessionId: "loan-copy-17" });
   if (!lent.ok) throw new Error(lent.reason);
   lent.effects.map((effect) => effect.kind); // => ["datamodel_init", "datamodel_change", "send_delayed"]
   ```

3. Read where the execution stands with `configuration`.

   ```ts
   configuration(lent.state); // => ["on_loan"]
   ```

4. Deliver an external event with `step`, passing the chart and the latest state.

   ```ts
   const renewed = step(loan, lent.state, { name: "loan.renew" });
   if (!renewed.ok) throw new Error(renewed.reason);
   renewed.effects.map((effect) => effect.kind); // => ["cancel", "datamodel_change", "send_delayed"]
   ```

5. Store the state as JSON between calls, and parse it back before the next one.

   ```ts
   const stored = JSON.stringify(renewed.state);
   const restored = JSON.parse(stored);
   configuration(restored); // => ["on_loan"]
   ```

6. Move the execution's virtual clock forward with `advance`, in milliseconds.

   ```ts
   const lapsed = advance(loan, restored, 14 * 24 * 60 * 60 * 1000);
   if (!lapsed.ok) throw new Error(lapsed.reason);
   configuration(lapsed.state); // => ["overdue"]
   ```

7. Deliver the event that ends the execution.

   ```ts
   const returned = step(loan, lapsed.state, { name: "loan.returned" });
   if (!returned.ok) throw new Error(returned.reason);
   returned.effects.map((effect) => effect.kind); // => ["done"]
   ```

8. Check that the execution stopped with `isDone`, and read its donedata.

   ```ts
   isDone(returned.state); // => { ok: true, done: true, donedata: { renewals: 1 }, configuration: ["returned"] }
   ```

If a call answers `{ ok: false, reason }`, handle the reason instead of using
a state: a stopped execution, for example, refuses a further event.

```ts
step(loan, returned.state, { name: "loan.renew" }); // => { ok: false, reason: "not_running" }
```

## See also

- [The six calls](https://github.com/riddler/statifier-ts/blob/main/README.md#the-six-calls): what each call takes, what it answers, and every refusal.
- [The effects](https://github.com/riddler/statifier-ts/blob/main/README.md#the-effects): every effect kind and what the host does with it.
- [The state](https://github.com/riddler/statifier-ts/blob/main/README.md#the-state): the fields of the state a call answers.
