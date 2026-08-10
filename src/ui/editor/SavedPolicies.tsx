import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useProgressStore } from '../../store/progressStore';

export function SavedPolicies(): JSX.Element {
  const [name, setName] = useState('');
  const savedPolicies = useProgressStore((s) => s.savedPolicies);
  const { savePolicy, deleteSavedPolicy } = useProgressStore.getState();
  const { loadPreset } = useEditorStore.getState();

  function handleSave(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    savePolicy(trimmed, useEditorStore.getState().policy);
    setName('');
  }

  return (
    <section aria-label="Saved policies">
      <h2>Saved policies</h2>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My SCAN v2" />
      </label>
      <button type="button" onClick={handleSave} disabled={name.trim().length === 0}>
        Save current policy
      </button>

      {savedPolicies.length === 0 ? (
        <p>No saved policies yet.</p>
      ) : (
        <ul>
          {savedPolicies.map((saved) => (
            <li key={saved.id}>
              {saved.name}
              <button type="button" onClick={() => loadPreset(saved.policy)}>
                Load
              </button>
              <button type="button" onClick={() => deleteSavedPolicy(saved.id)} aria-label={`Delete ${saved.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
