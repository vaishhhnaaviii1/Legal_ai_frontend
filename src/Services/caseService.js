const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const createCase = async (description, userId) => {
  const res = await (`${BASE_URL}/api/v1/cases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      case_description: description,
      user_id: userId,
    }),
  });

  return await res.json();
};

// 🔄 NEW: Regenerates summary for an existing case to prevent duplicate DB rows
export const regenerateSummary = async (caseId, description) => {
  const res = await fetch(`${BASE_URL}/api/v1/cases/${caseId}/regenerate`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: description,
    }),
  });

  return await res.json();
};

export const extractCharges = async (caseId, summary) => {
  const res = await fetch(
    `${BASE_URL}/api/v1/cases/${caseId}/extract-charges`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lawyer_approved_summary: summary,
      }),
    }
  );

  return await res.json();
};

export const finalizeCharges = async (caseId, approvedIds, rejectedData) => {
  const res = await fetch(
    `${BASE_URL}/api/v1/cases/${caseId}/finalize-charges`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approved_id: approvedIds,
        rejected_data: rejectedData,
      }),
    }
  );

  return await res.json();
};

export const fetchPrecedents = async (caseId) => {
  const res = await fetch(
    `${BASE_URL}/api/v1/cases/${caseId}/fetch-precedents`,
    {
      method: "POST",
    }
  );

  return await res.json();
};