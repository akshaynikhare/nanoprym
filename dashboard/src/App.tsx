/**
 * Nanoprym Dashboard — Read-only metrics viewer
 * React + Vite, served on localhost:3000
 */
import React, { useState, useEffect } from 'react';

interface DashboardData {
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  cloudCost: number;
  cloudBudget: number;
  agents: Array<{ id: string; role: string; state: string }>;
}

export default function App(): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Fetch from Nanoprym API when available
    setData({
      status: 'running',
      tasksCompleted: 0,
      tasksFailed: 0,
      cloudCost: 0,
      cloudBudget: 5.0,
      agents: [],
    });
  }, []);

  if (error) return <div style={{ padding: 20, color: 'red' }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 20 }}>Loading...</div>;

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <h1 style={{ borderBottom: '2px solid #333', paddingBottom: 8 }}>
        Nanoprym Dashboard
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
        <StatCard label="Status" value={data.status} color={data.status === 'running' ? '#22c55e' : '#ef4444'} />
        <StatCard label="Tasks Completed" value={String(data.tasksCompleted)} />
        <StatCard label="Tasks Failed" value={String(data.tasksFailed)} color={data.tasksFailed > 0 ? '#ef4444' : undefined} />
        <StatCard label="Cloud Cost" value={`$${data.cloudCost.toFixed(2)} / $${data.cloudBudget.toFixed(2)}`} />
      </div>

      <h2 style={{ marginTop: 32 }}>Active Agents</h2>
      {data.agents.length === 0 ? (
        <p style={{ color: '#666' }}>No active agents</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>ID</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Role</th>
              <th style={{ textAlign: 'left', padding: 8 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map(agent => (
              <tr key={agent.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{agent.id}</td>
                <td style={{ padding: 8 }}>{agent.role}</td>
                <td style={{ padding: 8 }}>{agent.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 40, color: '#999', fontSize: 12 }}>
        Nanoprym v0.1.0 | Dashboard is read-only | Data refreshes every 30s
      </p>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }): React.JSX.Element {
  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: 8,
      padding: 16,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? '#333' }}>{value}</div>
    </div>
  );
}
