use std::sync::atomic::Ordering;
use std::time::Instant;

use super::super::registry::unregister_stream;
use super::super::tests::app_without_a_client;
use super::scripted::{rig, Scripted, Step};
use super::tests::VIDEO;
use super::*;

#[tokio::test]
async fn forgetting_everything_aborts_every_pump_and_unregisters_its_stream() {
    let app = app_without_a_client();
    let proxy = app.state::<MediaProxy>();
    let source = Scripted::of([Step::Forever]);
    let dropped = source.drop_flag();
    let rig = rig(source, 4);
    let id = rig.pump.id;
    launch(app.handle(), VIDEO.to_owned(), None, rig.pump).await;
    assert_eq!(proxy.pumps.lock().await.len(), 1);

    proxy.forget_everything().await;

    assert!(proxy.pumps.lock().await.is_empty());
    assert!(!unregister_stream(id));
    let deadline = Instant::now() + Duration::from_secs(5);
    while !dropped.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "the pump must be aborted");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn a_finished_pump_removes_itself() {
    let app = app_without_a_client();
    let proxy = app.state::<MediaProxy>();
    let rig = rig(Scripted::of([]), 4);
    let id = rig.pump.id;

    launch(app.handle(), VIDEO.to_owned(), None, rig.pump).await;

    let deadline = Instant::now() + Duration::from_secs(5);
    while !proxy.pumps.lock().await.is_empty() {
        assert!(Instant::now() < deadline, "the pump must remove itself");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    unregister_stream(id);
}
