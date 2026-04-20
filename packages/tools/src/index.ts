import { searchFlightsTool } from './search-flights';
import { bookFlightTool } from './book-flight';
import { searchHotelsTool } from './search-hotels';
import { checkTreasuryTool } from './check-treasury';
import { gatewayBalanceTool } from './gateway-balance';
import { gatewayTransferTool } from './gateway-transfer';
import { swapTokensTool } from './swap-tokens';
import { sendTokensTool } from './send-tokens';
import { bridgeToArcTool } from './bridge-to-arc';
import { swapAndBridgeTool } from './swap-and-bridge';
import { settleSplitTool } from './settle-split';
import { checkPolicyTool } from './check-policy';
import { quoteFxTool } from './quote-fx';
import { rateAgentTool } from './rate-agent';
import type { ToolDef } from './types';

export type { ToolDef, ToolContext, JsonSchemaObject } from './types';

/**
 * Ordered canonical list of every tool Sendero ships. Register here
 * once; both the AI SDK chat route and the MCP server derive their
 * catalogs from this array. Avoids tool drift.
 */
export const toolList: ToolDef[] = [
  searchFlightsTool,
  bookFlightTool,
  searchHotelsTool,
  checkTreasuryTool,
  gatewayBalanceTool,
  gatewayTransferTool,
  swapTokensTool,
  sendTokensTool,
  bridgeToArcTool,
  swapAndBridgeTool,
  settleSplitTool,
  checkPolicyTool,
  quoteFxTool,
  rateAgentTool,
];

/** Keyed registry for O(1) lookup by name. */
export const tools: Record<string, ToolDef> = Object.fromEntries(toolList.map(t => [t.name, t]));
