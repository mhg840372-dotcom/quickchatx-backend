// utils/normalizeGender.js
export const normalizeGender = (value) => {
  if (!value) return "other"; // default
  const map = {
    masculino: "male",
    femenino: "female",
    otro: "other",
    male: "male",
    female: "female",
    other: "other",
  };
  return map[value.toLowerCase()] || "other";
};
