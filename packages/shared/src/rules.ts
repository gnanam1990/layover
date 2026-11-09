import eu261 from "../rules/eu261.json";
import uk261 from "../rules/uk261.json";
import us_dot from "../rules/us_dot.json";
import in_dgca from "../rules/in_dgca.json";
import airportsJson from "../data/airports.json";
import { Airport, RulePack } from "./schemas";
import type { Airport as AirportT, PackId, RulePack as RulePackT } from "./schemas";
import { z } from "zod";

/** Rule packs, validated at import time so a malformed pack fails fast. */
export const RULE_PACKS: Record<PackId, RulePackT> = {
  eu261: RulePack.parse(eu261),
  uk261: RulePack.parse(uk261),
  us_dot: RulePack.parse(us_dot),
  in_dgca: RulePack.parse(in_dgca),
};

export const AIRPORTS: Record<string, AirportT> = z.record(z.string(), Airport).parse(airportsJson);

export const RULES_DISCLAIMER =
  "Based on Layover rule packs (versions listed), not legal advice. Check the official source before relying on it.";
