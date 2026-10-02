// Plain-language names for analyzer rules (docs/ANALYZER.md §5). Display only: the report core keeps the rule id.
export const RULES: Record<string, { title: string; plain: string }> = {
  "TW-001": { title: "6- and 18-decimal amounts added together", plain: "Adds or subtracts an ERC-20 amount and a native amount as if they were the same unit." },
  "TW-002": { title: "6- and 18-decimal amounts compared", plain: "Compares an ERC-20 amount against a native amount. One side is a trillion times larger." },
  "TW-003": { title: "Native transfer sends a 6-decimal amount", plain: "Sends an ERC-20-sized number as msg.value. The recipient gets a trillionth of what was meant." },
  "TW-004": { title: "ERC-20 transfer sends an 18-decimal amount", plain: "Sends a native-sized number through USDC.transfer. That asks for a trillion times too much." },
  "TW-005": { title: "One storage slot holds both units", plain: "The same state variable is written with ERC-20 amounts in one place and native amounts in another." },
  "TW-006": { title: "Literal in the other view", plain: "A hard-coded amount is written for one view and used in the other." },
  "TW-007": { title: "Dust dropped on conversion", plain: "Converting native to ERC-20 rounds down, and the remainder is never accounted for." },
  "TW-008": { title: "Conversion applied the wrong way", plain: "An amount was scaled by 10¹² in the wrong direction, ending outside both views." },
  "TW-900": { title: "Unresolved token mixed with USDC", plain: "An amount from a token the analyzer couldn't identify is mixed with USDC math." },
};

export const ruleTitle = (id: string) => RULES[id]?.title ?? id;
