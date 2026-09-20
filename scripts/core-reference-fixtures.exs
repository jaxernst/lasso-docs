# Run with a compiled v0.4.3 Core checkout on the Erlang code path.
alias Lasso.RPC.{Channel, Observability, RequestContext, RequestOptions}
alias LassoWeb.Plugs.ObservabilityPlug

output = System.fetch_env!("DOCS_FIXTURE_OUTPUT")
File.mkdir_p!(output)

channel = fn id ->
  %Channel{
    profile: "public",
    chain_id: 1,
    provider_id: id,
    instance_id: "fixture-" <> id,
    transport: :http,
    route_generation: 7
  }
end

primary = channel.("primary")
backup = channel.("backup")

base = %RequestContext{
  request_id: "fixture-request",
  chain_id: 1,
  method: "eth_blockNumber",
  strategy: :priority,
  transport: :http,
  opts: %RequestOptions{profile: "public", timeout_ms: 2_000},
  candidate_providers: ["primary:http", "backup:http"],
  circuit_breaker_state: :closed,
  selection_latency_ms: 1.0,
  upstream_latency_ms: 20.0,
  end_to_end_latency_ms: 23.0,
  lasso_overhead_ms: 3.0
}

success =
  base
  |> RequestContext.record_channel_success(primary)
  |> RequestContext.set_executed_channel(primary)

failover =
  base
  |> RequestContext.record_channel_attempt(primary, %{category: :server_error, code: -32000})
  |> RequestContext.record_channel_success(backup)
  |> RequestContext.set_executed_channel(backup)
  |> Map.put(:retries, 1)

for {name, ctx} <- [{"success", success}, {"failover", failover}] do
  response =
    ObservabilityPlug.enrich_response_body(
      %{"jsonrpc" => "2.0", "id" => 1, "result" => "0x64"},
      ctx
    )

  metadata = Observability.build_client_metadata(ctx)
  {:ok, header} = Observability.encode_metadata_for_header(metadata)

  true =
    Jason.decode!(Base.url_decode64!(header, padding: false)) ==
      Jason.decode!(Jason.encode!(metadata))

  false = Map.has_key?(metadata, :head_policy)
  File.write!(Path.join(output, name <> ".json"), Jason.encode!(response, pretty: true) <> "\n")
  File.write!(Path.join(output, name <> "-header.txt"), header <> "\n")
end

error =
  Lasso.JSONRPC.Error.new(
    -32_000,
    "No available channels for method: eth_blockNumber. All circuits open, retry after 5s",
    data: %{retry_after_ms: 5_000}
  )

File.write!(
  Path.join(output, "exhaustion.json"),
  Jason.encode!(Lasso.JSONRPC.Error.to_response(error, "client-request-42"), pretty: true) <> "\n"
)

for file <- System.argv() do
  content = File.read!(file)

  for [_, yaml] <- Regex.scan(~r/```yaml\n(.*?)\n```/s, content) do
    body = YamlElixir.read_from_string!(yaml)
    :ok = Lasso.Config.FileSchema.validate_body!(body)
    :ok = Lasso.Config.FileSchema.validate_chains!(body["chains"])
  end
end

IO.puts("metadata fixtures and retained YAML validated")
