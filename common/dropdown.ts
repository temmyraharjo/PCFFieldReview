export interface DropdownItem {
    key: string;
    label: string;
}

export interface DropdownOptions {
    items: DropdownItem[];
    selectedKey: string | null;
    disabled: boolean;
    onChange: (key: string | null) => void;
}

export interface Dropdown {
    setItems: (items: DropdownItem[]) => void;
    setSelected: (key: string | null) => void;
    setDisabled: (disabled: boolean) => void;
    setLoading: (loading: boolean) => void;
    destroy: () => void;
}

const EMPTY_KEY = "";
const EMPTY_LABEL = "---";

/**
 * The single value picker shared by the Choice and Lookup controls, so both
 * field types look and behave identically on the form: a plain dropdown with
 * a "---" (no value) entry, the same as the platform's own Choice control.
 */
export function createDropdown(host: HTMLElement, options: DropdownOptions): Dropdown {
    const select = document.createElement("select");
    select.className = "ifr-select";
    host.appendChild(select);

    let items = options.items;
    let selectedKey = options.selectedKey;
    let disabled = options.disabled;
    let loading = false;

    function render() {
        select.innerHTML = "";
        select.appendChild(new Option(loading ? "Loading…" : EMPTY_LABEL, EMPTY_KEY));
        for (const item of items) {
            select.appendChild(new Option(item.label, item.key));
        }
        select.value = selectedKey !== null && items.some((i) => i.key === selectedKey) ? selectedKey : EMPTY_KEY;
        select.disabled = disabled || loading;
    }

    const onSelectChange = () => {
        selectedKey = select.value === EMPTY_KEY ? null : select.value;
        options.onChange(selectedKey);
    };
    select.addEventListener("change", onSelectChange);

    render();

    return {
        setItems: (next) => {
            items = next;
            render();
        },
        setSelected: (key) => {
            selectedKey = key;
            render();
        },
        setDisabled: (next) => {
            disabled = next;
            select.disabled = disabled || loading;
        },
        setLoading: (next) => {
            loading = next;
            render();
        },
        destroy: () => {
            select.removeEventListener("change", onSelectChange);
            select.remove();
        },
    };
}
