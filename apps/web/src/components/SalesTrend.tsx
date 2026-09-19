import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "../lib/format";

export type DailySale = { date: string; total: number; count: number };

const dayFmt = new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short" });
const fullFmt = new Intl.DateTimeFormat("es-HN", { weekday: "long", day: "numeric", month: "long" });

/** "2026-09-19" -> Date local, sin corrimiento por zona horaria. */
function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function compact(value: number) {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${value / 1_000}k`;
  return String(value);
}

/** Techo "redondo" divisible en 3 pasos, para que el eje diga 0/600/1200/1800. */
function niceMax(max: number) {
  if (max <= 0) return 10;
  const base = Math.pow(10, Math.floor(Math.log10(max / 3)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (base * m * 3 >= max) return base * m * 3;
  }
  return max;
}

export function SalesTrend({ data, sym }: { data: DailySale[]; sym: string }) {
  const top = niceMax(Math.max(...data.map((d) => d.total)));
  return (
    <div className="pf-trend h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="pfTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop id="pfTrendStopA" offset="0%" stopOpacity={0.28} />
              <stop id="pfTrendStopB" offset="100%" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => dayFmt.format(parseDay(v))}
            interval="preserveStartEnd"
            minTickGap={28}
            tickLine={false}
            axisLine={false}
            dy={6}
            fontSize={11}
          />
          <YAxis
            width={38}
            domain={[0, top]}
            ticks={[0, top / 3, (top * 2) / 3, top]}
            tickFormatter={compact}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const row = active && payload?.length ? (payload[0].payload as DailySale) : null;
              if (!row) return null;
              return (
                <div className="rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated px-3 py-2 shadow-[var(--pf-shadow-lg)]">
                  <p className="text-xs font-semibold capitalize text-pf-text">{fullFmt.format(parseDay(row.date))}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums text-pf-text">{formatMoney(sym, row.total)}</p>
                  <p className="text-xs text-pf-text-tertiary">
                    {row.count} venta{row.count !== 1 ? "s" : ""}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="total"
            strokeWidth={2}
            fill="url(#pfTrendFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
