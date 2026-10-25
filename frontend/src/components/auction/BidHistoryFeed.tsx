import React from "react";
import type { Bid } from "../../types/api.ts";
import { formatBrlCents } from "../../utils/formatters.ts";

interface BidHistoryFeedProps {
  bids: Bid[];
}

export const BidHistoryFeed: React.FC<BidHistoryFeedProps> = ({ bids }) => {
  return (
    <div className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-surface dark:bg-charcoal-surface">
      <div className="flex items-center justify-between border-b border-paper-border dark:border-charcoal-border px-5 py-3.5">
        <h2 className="font-sans text-base font-semibold text-paper-text dark:text-charcoal-text">
          Histórico de lances
        </h2>
        <span className="font-mono text-xs tabular-nums text-paper-subtext dark:text-charcoal-subtext">
          {bids.length} {bids.length === 1 ? "lance" : "lances"}
        </span>
      </div>

      {bids.length === 0 ? (
        <div className="p-6 text-center text-xs text-paper-subtext dark:text-charcoal-subtext">
          Nenhum lance enviado até o momento.
        </div>
      ) : (
        <ul className="divide-y divide-paper-border dark:divide-charcoal-border max-h-[380px] overflow-y-auto">
          {bids.map((bid) => (
            <li key={bid.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-sm border border-paper-border dark:border-charcoal-border bg-paper-bg dark:bg-charcoal-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    #{bid.sequence_number}
                  </span>
                  <span className="font-mono text-xs font-semibold text-paper-text dark:text-charcoal-text">
                    {bid.bidder_masked_name}
                  </span>
                  {bid.extension_triggered && (
                    <span className="border border-gold/60 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-gold">
                      +2 min
                    </span>
                  )}
                </div>

                <span className="font-mono text-sm font-bold tabular-nums text-paper-text dark:text-charcoal-text">
                  {formatBrlCents(bid.amount_cents)}
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-paper-subtext dark:text-charcoal-subtext">
                <span className="tabular-nums">
                  {new Date(bid.created_at).toLocaleTimeString("pt-BR")}
                </span>
                <span title={bid.current_hash}>
                  Hash: {bid.current_hash.slice(0, 16)}...
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
