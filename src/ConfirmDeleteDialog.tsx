import { useEffect, useRef } from 'react';

type Props = { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void };

export default function ConfirmDeleteDialog({ name, busy, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="delete-title" aria-describedby="delete-warning" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="delete-title">Delete forever?</h2>
    <p id="delete-warning"><strong>{name}</strong> will be permanently deleted. You won’t be able to restore it.</p>
    <div className="confirm-actions">
      <button className="secondary-button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete forever'}</button>
    </div>
  </dialog>;
}
