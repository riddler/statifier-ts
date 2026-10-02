### Changed

- The `send_rejected` execution reason carries `errorKind` (`execution` or `communication`), rendered as `error_kind` in an error event's data, so a send refused inside an `<if>` or a `<foreach>` keeps which error it would have raised, as the reference's rejection does.
