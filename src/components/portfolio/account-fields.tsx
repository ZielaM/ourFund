import { useTranslations } from "next-intl";
import { SelectField, TextField } from "@/components/form/fields";
import { ACCOUNT_TYPES } from "@/domain/portfolio/naming";

type AccountFieldsProps = {
  /** Stored values when editing an account. */
  initial?: { name: string; type: string; institution: string | null };
};

/** Name, type and institution of an account; used inside an <ActionForm>. */
export function AccountFields({ initial }: AccountFieldsProps) {
  const t = useTranslations("portfolio.accounts");
  const tTypes = useTranslations("accountTypes");

  return (
    <>
      <TextField
        name="name"
        label={t("name")}
        hint={initial ? undefined : t("nameHint")}
        defaultValue={initial?.name}
        autoComplete="off"
        required
      />
      <SelectField name="type" label={t("type")} defaultValue={initial?.type ?? "STANDARD"}>
        {ACCOUNT_TYPES.map((type) => (
          <option key={type} value={type}>
            {tTypes(type)}
          </option>
        ))}
      </SelectField>
      <TextField
        name="institution"
        label={t("institution")}
        hint={t("institutionHint")}
        defaultValue={initial?.institution ?? undefined}
        autoComplete="off"
      />
    </>
  );
}
