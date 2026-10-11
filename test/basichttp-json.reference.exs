# The generator of the reference table in `test/basichttp-json.test.ts`.
#
# It prints, for each value below, the text the reference's Basic HTTP
# processor writes for it: as a form parameter (the value under "v" in a
# map send's data) and as a `<content>` body (the value as the send's data).
# The value goes through the reference's public `deliver/3`, so the text is
# what its private `encode/1` and `json/1` clauses write, on its own runtime.
#
# Run it against a scratch export of statifier-ex at the tag the table names,
# never in a checkout of that repository:
#
#     git -C ../statifier-ex archive v2.13.0 | tar -x -C "$SCRATCH"
#     cd "$SCRATCH" && mise trust ./mise.toml
#     MIX_ENV=prod mise exec -- mix deps.get --only prod
#     MIX_ENV=prod mise exec -- mix compile --no-prune-code-paths
#     MIX_ENV=prod mise exec -- mix run --no-compile \
#       path/to/basichttp-json.reference.exs
#
# The compile keeps the code paths unpruned because the reference's
# `Mix.Statifier.BasicHTTPFront` reads a record from OTP's `inets`, which the
# package does not list as an application.
#
# Each output line is a JSON array: the value as the reference's runtime
# prints it, the parameter text, the body text, and the body's content type.

alias Statifier.Effect.Send
alias Statifier.Event
alias Statifier.Send.BasicHTTP

uri = "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor"

effect = fn data ->
  %Send{
    event: "ping",
    type: uri,
    target: "http://127.0.0.1:1/basichttp/sess_receiver",
    data: data,
    send_id: "send_1",
    c_index: 0,
    owner: {:onentry, 0, 0},
    macrostep: 1,
    microstep: 1,
    round: 0,
    ordinal: 1
  }
end

planned = fn data ->
  {:ok, [{:handler, BasicHTTP, {:post, post}}]} =
    BasicHTTP.deliver(effect.(data), Event.external("ping"), %{session_id: "sess_sender"})

  post
end

values = [
  [],
  %{},
  [1, 2],
  ["Dune", 2, 1.5, true, nil, [], %{}],
  [:undefined, "Dune"],
  %{"due" => :undefined},
  %{"loan" => %{"title" => "Dune", "copies" => 2}},
  [%{"patron" => "p-7", "holds" => ["Dune", "Emma"]}],
  [[[]], [%{}]],
  %{"b" => 1, "a" => 2, "B" => 3, "\u{E9}" => 4, "10" => 5, "2" => 6, "" => 7},
  %{"\u{FFFD}" => 1, "\u{1F4DA}" => 2, "z" => 3},
  [2.0, 0.1, -0.5, -0.0, 1.0e20, 1.0e15, 1.0e-7, 0.0001, 9_007_199_254_740_992.0],
  [0, -7, 123_456_789, 9_007_199_254_740_991],
  ["quote \" and backslash \\ and slash /"],
  ["line\nbreak", "tab\there", "return\rhere", "back\bspace", "form\ffeed"],
  [<<0>>, <<1>>, <<31>>, <<127>>],
  ["caf\u{E9}", "\u{1F4DA}", "\u{2028}\u{2029}", "<b>&amp;</b>"],
  %{"a\"b" => "c\\d", "line\nkey" => "v"},
  [true, false, nil]
]

for value <- values do
  param = planned.(%{"v" => value}).body |> URI.decode_query() |> Map.fetch!("v")
  content = planned.(value)
  {"content-type", type} = List.keyfind(content.headers, "content-type", 0)
  body = if is_list(value), do: content.body, else: nil
  IO.puts(JSON.encode!([inspect(value), param, body, if(body, do: type, else: nil)]))
end
