import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrainingMetric } from "../services/api";

interface MetricsChartProps {
  metrics: TrainingMetric[];
}

interface ChartPoint extends TrainingMetric {
  xVal: number; // epoch (int) or step
}

const MetricsChart: React.FC<MetricsChartProps> = ({ metrics }) => {
  if (!metrics || metrics.length === 0) return null;

  const hasEpoch = metrics.some((m) => m.epoch != null);
  const hasEvalLoss = metrics.some((m) => m.eval_loss != null);
  const hasLoss = metrics.some((m) => m.loss != null);

  const data: ChartPoint[] = metrics
    .filter((m) => m.step != null)
    .map((m) => ({
      ...m,
      xVal: hasEpoch && m.epoch != null ? Math.ceil(m.epoch) : m.step,
    }));

  // epoch 기반: 같은 epochInt끼리 집계 — train loss는 평균, eval_loss는 마지막값
  const chartData: ChartPoint[] = hasEpoch
    ? Object.values(
        data.reduce<Record<number, { sum: number; count: number; point: ChartPoint }>>(
          (acc, p) => {
            const key = p.xVal;
            if (!acc[key]) {
              acc[key] = { sum: 0, count: 0, point: { ...p } };
            }
            if (p.loss != null) {
              acc[key].sum += p.loss;
              acc[key].count += 1;
              acc[key].point.loss = acc[key].sum / acc[key].count;
            }
            if (p.eval_loss != null) {
              acc[key].point.eval_loss = p.eval_loss;
            }
            return acc;
          },
          {}
        )
      )
        .map((v) => v.point)
        .sort((a, b) => a.xVal - b.xVal)
    : data;

  // epoch 경계선 (step 모드에서만 사용)
  const epochBoundaries: { step: number; label: string }[] = [];
  if (!hasEpoch) {
    // step 모드에서는 경계선 없음
  }

  const xLabel = hasEpoch ? "Epoch" : "Step";

  // epoch 모드: x축 정수 tick 생성
  const xTicks = hasEpoch
    ? Array.from(new Set(chartData.map((d) => d.xVal))).sort((a, b) => a - b)
    : undefined;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600">Loss 곡선</span>
        <div className="flex gap-3 text-xs text-gray-400">
          {hasLoss && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-blue-500 inline-block" />Train
            </span>
          )}
          {hasEvalLoss && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-red-400 inline-block" />Eval
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="xVal"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={xTicks}
            tickFormatter={(v: number) => String(v)}
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            label={{ value: xLabel, position: "insideBottom", offset: -10, fontSize: 10, fill: "#9ca3af" }}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            width={45}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ChartPoint;
              return (
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs space-y-0.5">
                  <p className="font-semibold text-gray-700">
                    {hasEpoch ? `Epoch ${d.xVal}` : `Step ${d.xVal}`}
                    {hasEpoch && d.step != null && (
                      <span className="text-gray-400 font-normal ml-1">(step {d.step})</span>
                    )}
                  </p>
                  {d.loss != null && <p className="text-blue-600">Train Loss: {d.loss.toFixed(4)}</p>}
                  {d.eval_loss != null && <p className="text-red-500">Eval Loss: {d.eval_loss.toFixed(4)}</p>}
                  {d.learning_rate != null && <p className="text-gray-400">LR: {d.learning_rate.toExponential(2)}</p>}
                </div>
              );
            }}
          />
          {epochBoundaries.map(({ step, label }) => (
            <ReferenceLine key={step} x={step} stroke="#e5e7eb" strokeDasharray="4 2" label={{ value: label, position: "top", fontSize: 9, fill: "#d1d5db" }} />
          ))}
          {hasLoss && (
            <Line
              type="monotone"
              dataKey="loss"
              name="Train Loss"
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={hasEpoch ? { r: 3, fill: "#3b82f6" } : false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {hasEvalLoss && (
            <Line
              type="monotone"
              dataKey="eval_loss"
              name="Eval Loss"
              stroke="#ef4444"
              strokeWidth={1.5}
              dot={{ r: 3, fill: "#ef4444" }}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MetricsChart;
