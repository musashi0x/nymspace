import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Frame } from "./frame";
import { Field } from "./primitives";

/**
 * How to hand this screen to an agent.
 *
 * The form beside it is the same three writes — register the subname, attach
 * the resolver, publish the records — and a person filling it in is one of two
 * ways to reach them. This is the other, said out loud rather than left for
 * somebody to discover in the routes.
 *
 * ## Why the token is named and never shown
 *
 * `create_agent` registers an ENS subname and spends the organization's gas, so
 * the endpoint is gated on `CONSOLE_MCP_TOKEN` and answers 503 while that is
 * unset — an absent credential removing a capability rather than widening it.
 * The value lives in the deployment's environment and reaches this component
 * through nothing: it is a server secret, and a panel that rendered it would
 * put it in the HTML of a page anybody can open. So the snippet carries a
 * placeholder, and the operator pastes their own.
 *
 * The endpoint is public knowledge either way — it is the token that is worth
 * anything, which is the whole reason for showing one and not the other.
 */
export function AgentMcpPanel({ apiUrl }: { apiUrl: string }) {
  const endpoint = `${apiUrl.replace(/\/+$/, "")}/v1/mcp/console`;

  return (
    <Frame
      title="MCP"
      subtitle={
        "The same three writes this form performs, as tools an agent can call. " +
        "Claude Code, or any MCP client, can list the fleet and create an agent " +
        "through the endpoint below — through the same route, the same validator " +
        "and the same activity log as the form."
      }
    >
      <VStack gap={0} width="100%" className="min-w-0">
        <Field label="Endpoint" value={endpoint} />
        <Field
          label="Add it to Claude Code"
          value={`claude mcp add --transport http nymspace ${endpoint} --header "Authorization: Bearer $CONSOLE_MCP_TOKEN"`}
        />
        <Field
          label="Tools"
          value="list_agents · describe_parent · create_agent"
          mono={false}
        />
      </VStack>

      <VStack gap={2} maxWidth="42rem">
        <Text type="supporting" as="p">
          The endpoint answers 503 until <Text type="code">CONSOLE_MCP_TOKEN</Text>{" "}
          is set on the API, and 401 without a matching bearer token. It is not
          shown here: this page is served to anyone who can open the console, and
          the token is the only part of this arrangement worth keeping secret.
        </Text>
        <Text type="supporting" as="p">
          <Text type="code">create_agent</Text> spends gas and refuses a label the
          fleet already holds, because creating it again would rewrite that
          agent&rsquo;s on-chain record with whatever description the caller sent.
          Repairing a half-finished agent is this form&rsquo;s job, not the
          tool&rsquo;s.
        </Text>
      </VStack>
    </Frame>
  );
}
