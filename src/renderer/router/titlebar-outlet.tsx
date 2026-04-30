import { Outlet } from 'react-router';

import styles from './titlebar-outlet.module.css';

import { ServerRefreshButton } from '/@/renderer/features/titlebar/components/server-refresh-button';
import { Titlebar } from '/@/renderer/features/titlebar/components/titlebar';
import { useWindowBarStyle } from '/@/renderer/store/settings.store';
import { Platform } from '/@/shared/types/types';

export const TitlebarOutlet = () => {
    const windowBarStyle = useWindowBarStyle();

    return (
        <>
            {windowBarStyle === Platform.WEB && (
                <header className={styles.container}>
                    <Titlebar>
                        <ServerRefreshButton />
                    </Titlebar>
                </header>
            )}
            <Outlet />
        </>
    );
};
