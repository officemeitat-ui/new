"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Feedback = { ok: boolean; text: string };

const FeedbackContext = createContext<(feedback: Feedback) => void>(() => undefined);

/**
 * Page-level confirmation for report actions: a report that changes status may leave the
 * current filter, so its own row cannot show the message.
 */
export function ReportFeedback({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  return (
    <FeedbackContext.Provider value={setFeedback}>
      <div aria-live="polite">
        {feedback ? (
          <p
            role={feedback.ok ? "status" : "alert"}
            className={
              feedback.ok
                ? "rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
                : "rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            }
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
      {children}
    </FeedbackContext.Provider>
  );
}

export const useReportFeedback = () => useContext(FeedbackContext);
