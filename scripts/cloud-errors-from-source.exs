# Prints the Cloud error tables exactly as a Lasso Cloud source sends them, for
# snippets/cloud-errors-management.mdx and snippets/cloud-errors-rpc.mdx.
# Run from a lasso-cloud checkout at the deployed release:
#   MIX_ENV=test mix run --no-start /path/to/lasso-docs/scripts/cloud-errors-from-source.exs
Application.ensure_all_started(:phoenix)
mgmt_reasons = [
  {:unknown_chain, "<chain>"}, {:invalid_config, []}, {:provider_check_failed, "<provider>", 1, 10},
  :revision_conflict, :profile_limit, :payment_required, :amount_out_of_range, :payment_invalid,
  :payment_conflict, :beneficiary_conflict, :payment_failed, :payment_not_settled, :already_subscribed,
  :custom_access_required, :key_limit, :already_claimed, :account_merged, :profile_suspended,
  :not_found, :forbidden, :unauthorized, :key_revoked, :gone, :invalid_field,
  {:unknown_field, "<field>"}, :unavailable, :rate_limited, :payment_pending
]

render = fn conn -> {conn.status, Jason.decode!(conn.resp_body)} end
native = fn -> Plug.Test.conn(:get, "/") |> Plug.Conn.assign(:account_api_generation, %{generation: 1}) end
esc = fn s -> s |> String.replace("<", "&lt;") |> String.replace("{", "&#123;") |> String.replace("}", "&#125;") |> String.replace("|", "\\|") end

mgmt =
  for reason <- mgmt_reasons,
      result = (try do render.(LassoWeb.ManagementError.send_error(native.(), reason)) rescue e -> {:error, Exception.message(e)} end),
      match?({s, _} when is_integer(s), result) do
    {status, %{"error" => e}} = result
    {status, e["code"], e["next_action"]}
  end
  |> Enum.uniq_by(&elem(&1, 1))
  |> Enum.sort_by(&{elem(&1, 0), elem(&1, 1)})

IO.puts("MANAGEMENT")
for {s, c, a} <- mgmt, do: IO.puts("| `#{c}` | #{s} | #{esc.(a)} |")

rpc_reasons = ~w(key_revoked unauthorized unavailable not_prepared profile_config_unavailable forbidden unknown_profile unknown_chain balance_exhausted invalid_field invalid_request rate_limit_exceeded)a
IO.puts("RPC")
for reason <- rpc_reasons do
  conn = Plug.Test.conn(:post, "/rpc/k/x/base", ~s({"jsonrpc":"2.0","id":1,"method":"eth_chainId"})) |> Plug.Conn.put_req_header("content-type", "application/json") |> Map.put(:body_params, %{"jsonrpc" => "2.0", "id" => 1, "method" => "eth_chainId"}) |> Map.put(:params, %{"jsonrpc" => "2.0", "id" => 1})
  try do
    {status, body} = render.(LassoWeb.RPC.ServingErrors.reject(conn, reason))
    d = body["error"]["data"]
    IO.puts("| `#{d["code"]}` | #{status} | #{if d["retryable"], do: "Yes", else: "No"} | #{esc.(d["next_action"])} |")
  rescue
    e -> IO.puts("ERR #{reason}: #{Exception.message(e) |> String.slice(0, 200)}")
  end
end
